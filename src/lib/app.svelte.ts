// Global app state (Svelte 5 runes) and connection orchestration.

import { hex } from './protocol/bytes'
import { BleTransport, bleSupported } from './transport/ble'
import { HidTransport, hidSupported } from './transport/hid'
import type { Transport } from './transport/types'
import { allGattServices, bleNameFilters, gattProfilesFor, identifyModel, MODELS, type DeviceModel } from './devices/models'
import { createSession } from './devices/factory'
import type { BatteryInfo, DeviceSession, LiveSample } from './devices/types'
import { getFile, hasFile, listFiles, markRemoved, removedIds, saveFile, type PatientInfo, type StoredFile } from './storage'
import { sniffFormat, parseAny } from './files/parse'

export interface LogLine {
  t: number
  dir: 'tx' | 'rx' | 'info' | 'error'
  text: string
}

export type Tab = 'device' | 'recordings' | 'trends' | 'options'

export interface Prefs {
  syncTime: boolean
  debug: boolean
  /** SpO2 chart Y range: 'auto' or 'min-100'. */
  spo2Range: string
  /** Pulse chart Y range: 'auto' or 'min-max'. */
  prRange: string
  units: 'metric' | 'imperial'
  /** Pre-filled patient info for new reports. */
  defaultPatient: PatientInfo
}

const DEFAULT_PREFS: Prefs = {
  syncTime: true,
  debug: false,
  spo2Range: 'auto',
  prRange: 'auto',
  units: 'metric',
  defaultPatient: {},
}

const prefs = loadPrefs()

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('prefs') ?? '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export const app = $state({
  tab: 'device' as Tab,
  session: null as DeviceSession | null,
  connecting: false,
  status: '',
  error: '',
  battery: null as BatteryInfo | null,
  deviceFiles: [] as { name: string; stored: boolean; removed: boolean }[],
  download: null as { name: string; done: number; total: number; index: number; count: number } | null,
  live: null as LiveSample | null,
  liveOn: false,
  wave: [] as number[],
  files: [] as StoredFile[],
  selectedId: null as string | null,
  log: [] as LogLine[],
  prefs,
  support: {
    ble: bleSupported(),
    hid: hidSupported(),
  },
})

export function savePrefs() {
  try {
    localStorage.setItem('prefs', JSON.stringify(app.prefs))
  } catch {
    /* ignore */
  }
}

export function log(dir: LogLine['dir'], text: string) {
  app.log.push({ t: Date.now(), dir, text })
  if (app.log.length > 500) app.log.splice(0, app.log.length - 500)
}

function attachLogging(t: Transport) {
  t.onLog = (dir, data) => {
    if (!app.prefs.debug) return
    const h = hex(data.length > 96 ? data.subarray(0, 96) : data)
    log(dir, data.length > 96 ? `${h} … (${data.length} B)` : h)
  }
}

function errText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') return ''
  return e instanceof Error ? e.message : String(e)
}

export async function refreshStoredFiles() {
  app.files = await listFiles()
}

interface Opened {
  transport: Transport
  model: DeviceModel
  wire: 'oxyii' | 'legacy'
}

export async function connectBle() {
  await connectWith(async () => {
    const device = await BleTransport.pick(bleNameFilters(), allGattServices())
    const model = identifyModel(device.name)
    if (!model) throw new Error(`Unsupported device "${device.name ?? 'unknown'}"`)
    app.status = `Connecting to ${device.name}…`
    const transport = await BleTransport.connect(device, { profiles: gattProfilesFor(model) })
    return { transport, model, wire: transport.profile.id === 'oxyii' ? 'oxyii' : 'legacy' }
  })
}

export async function connectUsb() {
  await connectWith(async () => {
    const transport = await HidTransport.request()
    const model = identifyModel(transport.name) ?? MODELS.find((m) => m.id === 124)!
    return { transport, model, wire: 'oxyii' }
  })
}

async function connectWith(open: () => Promise<Opened>) {
  app.error = ''
  app.connecting = true
  app.status = 'Connecting…'
  let transport: Transport | null = null
  try {
    const opened = await open()
    transport = opened.transport
    const model = opened.model
    attachLogging(transport)
    const session = createSession(transport, model, opened.wire)
    session.onStatus = (m) => (app.status = m)
    session.onDisconnect = () => {
      log('info', 'Device disconnected')
      resetConnection()
      app.error = 'Device disconnected'
    }
    log('info', `Connected to ${transport.name} (${model.name}) via ${transport.kind.toUpperCase()}`)
    await session.init({ syncTime: app.prefs.syncTime })
    app.session = session
    log('info', `Device info: ${JSON.stringify(session.info)}`)
    app.status = ''
    await refreshBattery()
    await refreshDeviceFiles()
  } catch (e) {
    const msg = errText(e)
    if (msg) {
      app.error = msg
      log('error', msg)
    }
    if (transport && !app.session) await transport.close().catch(() => {})
    app.status = ''
  } finally {
    app.connecting = false
  }
}

function resetConnection() {
  app.session = null
  app.live = null
  app.liveOn = false
  app.wave = []
  app.battery = null
  app.deviceFiles = []
  app.download = null
  app.status = ''
}

export async function disconnect() {
  const s = app.session
  resetConnection()
  if (s) await s.close().catch(() => {})
}

export async function refreshBattery() {
  const s = app.session
  if (!s) return
  try {
    app.battery = await s.getBattery()
  } catch (e) {
    log('error', `Battery: ${errText(e)}`)
  }
}

function fileId(name: string): string {
  return `${app.session?.info?.sn || 'device'}/${name}`
}

export async function refreshDeviceFiles() {
  const s = app.session
  if (!s) return
  // Newest first (names are yyyyMMddHHmmss on all known devices).
  const names = (await s.listFiles()).sort((a, b) => b.localeCompare(a))
  const rows = []
  const removed = removedIds()
  for (const name of names) {
    const id = fileId(name)
    rows.push({ name, stored: await hasFile(id), removed: removed.has(id) })
  }
  app.deviceFiles = rows
}

let downloadAbort: AbortController | null = null

export async function downloadFiles(names: string[]) {
  const s = app.session
  if (!s || app.download) return
  downloadAbort = new AbortController()
  app.error = ''
  try {
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      app.download = { name, done: 0, total: 0, index: i, count: names.length }
      const bytes = await s.readFile(
        name,
        (p) => {
          app.download = { name, done: p.done, total: p.total, index: i, count: names.length }
        },
        downloadAbort.signal,
      )
      log('info', `Downloaded ${name} (${bytes.length} B)`)
      // Keep the raw bytes even if we can't parse them (they can be exported).
      let format = 'unknown'
      let startTime: number | undefined
      try {
        format = sniffFormat(bytes)
        startTime = parseAny(bytes, format, name).start
      } catch (e) {
        log('error', `Parse ${name}: ${errText(e)}`)
      }
      const id = fileId(name)
      const prev = await getFile(id)
      const dp = app.prefs.defaultPatient
      await saveFile({
        id,
        fileName: name,
        format,
        deviceModel: s.info?.model,
        deviceSn: s.info?.sn,
        startTime,
        addedAt: prev?.addedAt ?? Date.now(),
        bytes,
        // Keep user annotations on re-download.
        note: prev?.note,
        patient: prev?.patient ?? (Object.keys(dp).length ? { ...dp } : undefined),
      })
      markRemoved([id], false)
      const row = app.deviceFiles.find((f) => f.name === name)
      if (row) {
        row.stored = true
        row.removed = false
      }
    }
  } catch (e) {
    let msg = errText(e)
    if (msg && /0xf2|0x03/.test(msg)) {
      msg += '. Some rings refuse downloads while worn: take the ring off (or put it on the charger) and try again.'
    }
    if (msg) {
      app.error = `Download failed: ${msg}`
      log('error', app.error)
    }
  } finally {
    app.download = null
    downloadAbort = null
    await refreshStoredFiles()
  }
}

export function cancelDownload() {
  downloadAbort?.abort()
}

export function toggleLive() {
  const s = app.session
  if (!s || s.transport.kind === 'hid') return
  if (app.liveOn) {
    app.liveOn = false
    void s.stopLive()
    return
  }
  app.liveOn = true
  app.wave = []
  s.startLive((sample) => {
    app.live = sample
    if (sample.battery !== undefined && sample.batteryState) {
      app.battery = { percent: sample.battery, state: sample.batteryState, mV: app.battery?.mV }
    }
    const w = app.wave.concat(sample.wave)
    app.wave = w.length > 600 ? w.slice(w.length - 600) : w
  })
}

export async function importFiles(list: FileList | File[]) {
  for (const f of Array.from(list)) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    try {
      const format = sniffFormat(bytes)
      const rec = parseAny(bytes, format, f.name)
      const dp = app.prefs.defaultPatient
      await saveFile({
        id: `import/${f.name}`,
        fileName: f.name,
        format,
        startTime: rec.start,
        addedAt: Date.now(),
        bytes,
        patient: Object.keys(dp).length ? { ...dp } : undefined,
      })
      log('info', `Imported ${f.name}`)
    } catch (e) {
      app.error = `Could not import ${f.name}: ${errText(e)}`
      log('error', app.error)
    }
  }
  await refreshStoredFiles()
}
