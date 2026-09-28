// Global app state (Svelte 5 runes) and connection orchestration.

import { hex } from './protocol/bytes'
import { BleTransport, bleSupported } from './transport/ble'
import { HidTransport, hidSupported } from './transport/hid'
import type { Transport } from './transport/types'
import {
  allGattServices,
  bleNameFilters,
  gattProfilesFor,
  identifyModel,
  MODELS,
  OXYII_GATT,
  type DeviceModel,
} from './devices/models'
import { LegacyNoResponse } from './devices/legacySession'
import { createSession } from './devices/factory'
import { OxyIISession } from './devices/oxyiiSession'
import type { BatteryInfo, DeviceInfo, DeviceSession, LiveSample } from './devices/types'
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
  /** Reactive copy of session.info (sessions are plain classes). */
  info: null as DeviceInfo | null,
  connecting: false,
  status: '',
  error: '',
  battery: null as BatteryInfo | null,
  deviceFiles: [] as { name: string; stored: boolean; removed: boolean }[],
  download: null as { name: string; done: number; total: number; index: number; count: number } | null,
  live: null as LiveSample | null,
  liveOn: false,
  wave: [] as number[],
  /** Recent live motion readings, one per poll (null = not available). */
  motionHist: [] as (number | null)[],
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

function newSession(transport: Transport, model: DeviceModel, wire: 'oxyii' | 'legacy'): DeviceSession {
  const session = createSession(transport, model, wire)
  session.onStatus = (m) => (app.status = m)
  session.onWarn = (m) => log('error', m)
  session.onDisconnect = () => {
    if (app.session !== session) return
    log('info', 'Device disconnected')
    resetConnection()
    app.error = 'Device disconnected'
  }
  return session
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
    log('info', `Connected to ${transport.name} (${model.name}) via ${transport.kind.toUpperCase()}`)
    let session = newSession(transport, model, opened.wire)
    try {
      await session.init({ syncTime: app.prefs.syncTime })
    } catch (e) {
      // Dual-protocol rings on newer firmware keep the legacy service but only
      // answer OxyII (the vendor app picks the service from advertising data,
      // which browsers can't read before connecting).
      const t = transport
      if (!(e instanceof LegacyNoResponse) || !(t instanceof BleTransport) || !(await t.hasService(OXYII_GATT.service))) throw e
      log('info', 'No answer on the legacy service; switching to the OxyII service')
      await t.switchProfile(OXYII_GATT)
      session = newSession(t, model, 'oxyii')
      await session.init({ syncTime: app.prefs.syncTime })
    }
    app.session = session
    app.info = session.info ? { ...session.info } : null
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

/** Re-read device info (and battery) into reactive state. */
export async function refreshInfo() {
  const s = app.session
  if (!s) return
  await s.refreshInfo()
  if (app.session === s) app.info = s.info ? { ...s.info } : null
  await refreshBattery()
}

export async function syncClock() {
  const s = app.session
  if (!s) return
  await s.syncTime()
  await refreshInfo()
}

function resetConnection() {
  app.session = null
  app.info = null
  app.live = null
  app.liveOn = false
  app.wave = []
  app.motionHist = []
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

function fileId(s: DeviceSession, name: string): string {
  return `${s.info?.sn || 'device'}/${name}`
}

export function deviceFileId(name: string): string | null {
  return app.session ? fileId(app.session, name) : null
}

export async function refreshDeviceFiles() {
  const s = app.session
  if (!s) return
  // Newest first (names are yyyyMMddHHmmss on all known devices).
  const names = (await s.listFiles()).sort((a, b) => b.localeCompare(a))
  const rows = []
  const removed = removedIds()
  for (const name of names) {
    const id = fileId(s, name)
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
      // Recordings still in progress have no trailer yet; remember the device's
      // storage interval so they can be shown on the right time scale.
      const intervalHint = s instanceof OxyIISession ? s.config?.interval : undefined
      let format = 'unknown'
      let startTime: number | undefined
      try {
        format = sniffFormat(bytes)
        startTime = parseAny(bytes, format, name, intervalHint).start
      } catch (e) {
        log('error', `Parse ${name}: ${errText(e)}`)
      }
      const id = fileId(s, name)
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
        intervalHint,
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

/** Live motion samples kept for the trend strip (about 2 minutes at 1 poll/s). */
export const MOTION_HISTORY = 120

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
  app.motionHist = []
  s.startLive((sample) => {
    app.live = sample
    const m = app.motionHist.concat([sample.motion])
    app.motionHist = m.length > MOTION_HISTORY ? m.slice(m.length - MOTION_HISTORY) : m
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
      // Same name and same bytes: update in place, keeping annotations.
      // Same name, different recording: store it next to the existing one.
      let id = `import/${f.name}`
      let prev = await getFile(id)
      for (let n = 2; prev && !sameBytes(prev.bytes, bytes); n++) {
        id = `import/${f.name} (${n})`
        prev = await getFile(id)
      }
      const dp = app.prefs.defaultPatient
      await saveFile({
        id,
        fileName: f.name,
        format,
        startTime: rec.start,
        addedAt: prev?.addedAt ?? Date.now(),
        bytes,
        note: prev?.note,
        patient: prev?.patient ?? (Object.keys(dp).length ? { ...dp } : undefined),
      })
      app.selectedId = id
      log('info', `Imported ${f.name}`)
    } catch (e) {
      app.error = `Could not import ${f.name}: ${errText(e)}`
      log('error', app.error)
    }
  }
  await refreshStoredFiles()
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** After local storage was wiped: nothing on the device counts as downloaded or removed. */
export function resetDeviceFileMarks() {
  for (const row of app.deviceFiles) {
    row.stored = false
    row.removed = false
  }
}
