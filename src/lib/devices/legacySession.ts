// Device session for the legacy 0xAA protocol family (original O2Ring,
// Checkme O2 / O2 Max, SleepU, Oxylink, KidsO2, BabyO2, WearO2, ...).
// Connect flow (ViHealth O2BleBindLoaderImpl): SetTIME -> INFO -> files -> RT.

import {
  LEGACY_ALLOWED,
  LegacyCmd,
  LegacyDecoder,
  encodeLegacy,
  legacyFileList,
  legacyTimeString,
  num,
  paraSyncPayload,
  parseLegacyInfo,
  parseLegacyRtParam,
  parseLegacyRtWave,
  readStartPayload,
  type LegacyFrame,
  type LegacyInfo,
} from '../protocol/legacy'
import type { Transport } from '../transport/types'
import type { DeviceModel } from './models'
import {
  DeviceError,
  type BatteryInfo,
  type BatteryState,
  type DeviceInfo,
  type DeviceSession,
  type LiveSample,
  type ReadProgress,
  type SettingDef,
} from './types'

interface Pending {
  resolve: (f: LegacyFrame) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BATTERY: BatteryState[] = ['normal', 'charging', 'full']

export class LegacySession implements DeviceSession {
  readonly family = 'legacy' as const
  info: DeviceInfo | null = null
  raw: LegacyInfo | null = null
  onDisconnect: () => void = () => {}
  onStatus?: (msg: string) => void

  private decoder = new LegacyDecoder()
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private liveRunning = false
  private liveLoop: Promise<void> | null = null
  private liveCb: ((s: LiveSample) => void) | null = null
  private useWave = true

  constructor(
    readonly transport: Transport,
    readonly model: DeviceModel,
  ) {
    transport.onData = (c) => this.onData(c)
    transport.onDisconnect = () => {
      this.closed = true
      this.liveRunning = false
      this.fail(new DeviceError('Device disconnected'))
      this.onDisconnect()
    }
  }

  private onData(chunk: Uint8Array) {
    for (const f of this.decoder.push(chunk)) {
      const p = this.pending
      if (!p) continue // unsolicited / late: drop
      clearTimeout(p.timer)
      this.pending = null
      p.resolve(f)
    }
  }

  private fail(e: Error) {
    const p = this.pending
    if (!p) return
    clearTimeout(p.timer)
    this.pending = null
    p.reject(e)
  }

  request(cmd: number, payload?: Uint8Array, opts: { pktNo?: number; timeout?: number } = {}): Promise<Uint8Array> {
    const run = () => this.exchange(cmd, payload ?? new Uint8Array(0), opts)
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => {})
    return p
  }

  private async exchange(cmd: number, payload: Uint8Array, opts: { pktNo?: number; timeout?: number }) {
    if (!LEGACY_ALLOWED.has(cmd)) throw new DeviceError(`Refusing to send legacy opcode 0x${cmd.toString(16)}`)
    if (this.closed) throw new DeviceError('Not connected')
    const reply = new Promise<LegacyFrame>((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = null
          // Responses carry no command id; drop anything half-received.
          this.decoder.reset()
          reject(new DeviceError(`Timeout waiting for reply to 0x${cmd.toString(16).padStart(2, '0')}`))
        }, opts.timeout ?? 6000),
      }
    })
    try {
      await this.transport.write(encodeLegacy(cmd, payload, opts.pktNo ?? 0))
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)))
    }
    const f = await reply
    if (f.status !== 0) throw new DeviceError(`Device rejected 0x${cmd.toString(16)} (status 0x${f.status.toString(16)})`)
    return f.payload
  }

  async init(opts: { syncTime: boolean }): Promise<void> {
    this.decoder.reset()
    if (opts.syncTime) {
      this.onStatus?.('Setting clock…')
      await this.syncTime()
    }
    this.onStatus?.('Reading device info…')
    await this.refreshInfo()
  }

  async refreshInfo(): Promise<DeviceInfo> {
    const j = parseLegacyInfo(await this.request(LegacyCmd.INFO))
    this.raw = j
    const s = (k: string) => (j[k] === undefined ? undefined : String(j[k]).replace(/\p{Cc}/gu, ''))
    const extra: Record<string, string | number> = {}
    for (const k of ['Region', 'Model', 'SPCPVer', 'CurMode', 'CurState']) if (j[k] !== undefined) extra[k] = String(j[k])
    this.info = {
      model: this.model.name,
      modelId: this.model.id,
      sn: s('SN'),
      hwVersion: s('HardwareVer'),
      fwVersion: s('SoftwareVer'),
      bootloaderVersion: s('BootloaderVer'),
      branchCode: s('BranchCode'),
      fileVersion: num(j, 'FileVer'),
      deviceTime: s('CurTIME')?.replace(',', ' '),
      extra,
    }
    return this.info
  }

  async getBattery(): Promise<BatteryInfo | null> {
    const j = this.raw ?? (await this.refreshInfo(), this.raw)
    const pct = j ? num(j, 'CurBAT') : undefined
    if (pct === undefined) return null
    return { percent: pct, state: BATTERY[num(j!, 'CurBatState') ?? 0] ?? 'normal' }
  }

  async syncTime(): Promise<void> {
    await this.request(LegacyCmd.PARA_SYNC, paraSyncPayload({ SetTIME: legacyTimeString(new Date()) }))
  }

  async listFiles(): Promise<string[]> {
    await this.refreshInfo()
    return legacyFileList(this.raw ?? {})
  }

  async readFile(name: string, onProgress?: (p: ReadProgress) => void, signal?: AbortSignal): Promise<Uint8Array> {
    const wasLive = this.liveRunning
    if (wasLive) await this.pauseLive()
    try {
      const start = await this.request(LegacyCmd.READ_START, readStartPayload(name))
      if (start.length < 4) throw new DeviceError('READ_START reply too short')
      const size = (start[0] | (start[1] << 8) | (start[2] << 16) | (start[3] << 24)) >>> 0
      if (size <= 0 || size > 2_000_000) throw new DeviceError(`Unexpected file size ${size}`)
      const out = new Uint8Array(size)
      let got = 0
      let pkt = 0
      try {
        while (got < size) {
          if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
          let chunk: Uint8Array | null = null
          for (let attempt = 0; attempt < 3 && !chunk; attempt++) {
            try {
              chunk = await this.request(LegacyCmd.READ_CONTENT, undefined, { pktNo: pkt })
            } catch (e) {
              if (attempt === 2 || !(e instanceof DeviceError) || !/Timeout/.test(e.message)) throw e
            }
          }
          if (!chunk || !chunk.length) throw new DeviceError('Empty file chunk')
          const n = Math.min(chunk.length, size - got)
          out.set(chunk.subarray(0, n), got)
          got += n
          pkt++
          onProgress?.({ done: got, total: size })
        }
      } finally {
        await this.request(LegacyCmd.READ_END).catch(() => {})
      }
      return out
    } finally {
      if (wasLive && this.liveCb) this.startLive(this.liveCb)
    }
  }

  async getSettings(): Promise<SettingDef[]> {
    await this.refreshInfo()
    return legacySettingDefs(this.raw ?? {}, this.model)
  }

  async writeSetting(key: string, value: number): Promise<void> {
    const j = this.raw ?? {}
    let params: Record<string, number>
    switch (key) {
      case 'oxiVibrate':
        params = { SetOxiSwitch: (value ? 1 : 0) | ((num(j, 'OxiSwitch') ?? 0) & 2) }
        break
      case 'hrVibrate':
        params = { SetHRSwitch: (value ? 1 : 0) | ((num(j, 'HRSwitch') ?? 0) & 2) }
        break
      case 'oxiThr':
        params = { SetOxiThr: value }
        break
      case 'hrLow':
        params = { SetHRLowThr: value }
        break
      case 'hrHigh':
        params = { SetHRHighThr: value }
        break
      case 'motor':
        params = { SetMotor: value }
        break
      case 'buzzer':
        params = { SetBuzzer: value }
        break
      case 'lightingMode':
        params = { SetLightingMode: value }
        break
      case 'lightStr':
        params = { SetLightStr: value }
        break
      default:
        throw new DeviceError(`Unknown setting ${key}`)
    }
    const wasLive = this.liveRunning
    if (wasLive) await this.pauseLive()
    try {
      await this.request(LegacyCmd.PARA_SYNC, paraSyncPayload(params))
      await this.refreshInfo()
    } finally {
      if (wasLive && this.liveCb) this.startLive(this.liveCb)
    }
  }

  startLive(onSample: (s: LiveSample) => void): void {
    this.liveCb = onSample
    if (this.liveRunning) return
    this.liveRunning = true
    let waveFailures = 0
    this.liveLoop = (async () => {
      await sleep(300)
      while (this.liveRunning && !this.closed) {
        const t0 = Date.now()
        try {
          let sample: LiveSample | null = null
          if (this.useWave) {
            const w = parseLegacyRtWave(await this.request(LegacyCmd.RT_WAVE, new Uint8Array([0])))
            if (w) {
              waveFailures = 0
              const valid = ![0, 127, 255].includes(w.spo2) && ![0, 255, 511, 65535].includes(w.pr)
              sample = {
                t: Date.now(),
                spo2: valid ? w.spo2 : null,
                pr: valid ? w.pr : null,
                pi: valid && w.piRaw && w.piRaw !== 255 ? w.piRaw / 10 : null,
                motion: null,
                battery: w.battery,
                batteryState: BATTERY[w.batteryState] ?? 'normal',
                sensor: w.state === 1 ? 'ok' : w.state === 0 ? 'no-finger' : 'fault',
                wave: w.wave,
              }
            } else if (++waveFailures >= 2) this.useWave = false
          } else {
            const r = parseLegacyRtParam(await this.request(LegacyCmd.RT_PARAM))
            if (r) {
              const valid = ![0, 127, 255].includes(r.spo2) && ![0, 255, 511, 65535].includes(r.pr)
              sample = {
                t: Date.now(),
                spo2: valid ? r.spo2 : null,
                pr: valid ? r.pr : null,
                pi: valid && r.piRaw && r.piRaw !== 255 ? r.piRaw / 10 : null,
                motion: r.motion === 255 ? null : r.motion,
                battery: r.battery,
                batteryState: BATTERY[r.batteryState] ?? 'normal',
                sensor: r.leadOn || this.model.ignoreLead ? 'ok' : 'no-finger',
                wave: [],
              }
            }
          }
          if (sample && this.liveRunning) this.liveCb?.(sample)
        } catch (e) {
          if (this.closed) break
          if (this.useWave && ++waveFailures >= 2) this.useWave = false
          console.warn('live poll failed', e)
        }
        await sleep(Math.max(0, 1000 - (Date.now() - t0)))
      }
    })()
  }

  private async pauseLive(): Promise<void> {
    this.liveRunning = false
    await this.liveLoop
    this.liveLoop = null
  }

  async stopLive(): Promise<void> {
    await this.pauseLive()
    this.liveCb = null
  }

  async close(): Promise<void> {
    this.liveRunning = false
    this.closed = true
    this.fail(new DeviceError('Closed'))
    await this.transport.close()
  }
}

function range(a: number, b: number, step: number, unit: string) {
  const out = []
  for (let v = a; v <= b; v += step) out.push({ value: v, label: `${v}${unit}` })
  return out
}

/** Settings offered for legacy devices; only keys the device reports are shown. */
export function legacySettingDefs(j: LegacyInfo, model: DeviceModel): SettingDef[] {
  const defs: SettingDef[] = []
  const has = (k: string) => j[k] !== undefined && j[k] !== ''
  const r = model.legacyRanges ?? {}
  if (has('OxiSwitch')) defs.push({ key: 'oxiVibrate', label: 'SpO₂ reminder (vibrate)', kind: 'toggle', value: (num(j, 'OxiSwitch') ?? 0) & 1 })
  if (has('CurOxiThr')) {
    const [a, b, s] = r.oxiThr ?? [80, 95, 1]
    defs.push({ key: 'oxiThr', label: 'SpO₂ threshold', kind: 'select', options: range(a, b, s, ' %'), value: num(j, 'CurOxiThr')! })
  }
  if (has('HRSwitch')) defs.push({ key: 'hrVibrate', label: 'Pulse rate reminder (vibrate)', kind: 'toggle', value: (num(j, 'HRSwitch') ?? 0) & 1 })
  if (has('HRLowThr')) {
    const [a, b, s] = r.hrLow ?? [30, 70, 5]
    defs.push({ key: 'hrLow', label: 'Low pulse rate threshold', kind: 'select', options: range(a, b, s, ' bpm'), value: num(j, 'HRLowThr')! })
  }
  if (has('HRHighThr')) {
    const [a, b, s] = r.hrHigh ?? [70, 200, 5]
    defs.push({ key: 'hrHigh', label: 'High pulse rate threshold', kind: 'select', options: range(a, b, s, ' bpm'), value: num(j, 'HRHighThr')! })
  }
  if (has('CurMotor')) {
    const levels = r.motor ?? [20, 40, 60, 80, 100]
    const names = ['Weakest', 'Weak', 'Medium', 'Strong', 'Very strong']
    defs.push({
      key: 'motor',
      label: 'Vibration strength',
      kind: 'select',
      options: levels.map((v, i) => ({ value: v, label: names[i] ?? String(v) })),
      value: num(j, 'CurMotor')!,
    })
  }
  if (has('CurBuzzer') && model.hasBuzzer) {
    const levels = r.motor ?? [20, 40, 60, 80, 100]
    defs.push({
      key: 'buzzer',
      label: 'Reminder volume',
      kind: 'select',
      options: [{ value: 0, label: 'Off' }, ...levels.map((v, i) => ({ value: v, label: ['Very low', 'Low', 'Medium', 'High', 'Maximum'][i] ?? String(v) }))],
      value: num(j, 'CurBuzzer')!,
    })
  }
  if (has('LightingMode'))
    defs.push({
      key: 'lightingMode',
      label: 'Screen mode',
      kind: 'select',
      options: [
        { value: 0, label: 'Standard' },
        { value: 2, label: 'Always on' },
      ],
      value: num(j, 'LightingMode')!,
    })
  const light = has('LightStr') ? 'LightStr' : has('LightStrength') ? 'LightStrength' : null
  if (light)
    defs.push({
      key: 'lightStr',
      label: 'Screen brightness',
      kind: 'select',
      options: [
        { value: 0, label: 'Low' },
        { value: 1, label: 'Medium' },
        { value: 2, label: 'High' },
      ],
      value: num(j, light)!,
    })
  for (const d of defs) {
    if (d.kind === 'select' && d.options && !d.options.some((o) => o.value === d.value)) {
      d.options = [...d.options, { value: d.value, label: `${d.value} (device value)` }]
    }
  }
  return defs
}
