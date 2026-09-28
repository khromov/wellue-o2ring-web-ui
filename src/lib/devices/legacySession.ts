// Device session for the legacy 0xAA protocol family (original O2Ring,
// Checkme O2 / O2 Max, SleepU, Oxylink, KidsO2, BabyO2, WearO2, ...).
// Connect flow (ViHealth O2BleBindLoaderImpl): SetTIME -> INFO -> files -> RT.
// We read INFO first so a silent legacy service (a dual-protocol ring running
// OxyII firmware) is detected quickly and the app can fall back to OxyII.

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
import { LivePoller } from './live'
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
  pktNo: number
  resolve: (f: LegacyFrame) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Thrown when the legacy service never answers (see LegacySession.init). */
export class LegacyNoResponse extends DeviceError {}

const BATTERY: BatteryState[] = ['normal', 'charging', 'full']
/** ViHealth polls RT_PARAM (no waveform) for these models, RT_WAVE for the rest. */
const RT_PARAM_MODELS = new Set([1, 2, 3, 4, 5, 6, 10, 11, 13, 25, 29, 48, 63, 64, 65, 69, 101, 113, 130, 199, 203, 225])
/** Models whose SpO2/PR reminder is a single "reminder in device" (sound) switch. */
const SOUND_SWITCH_MODELS = new Set([5, 10, 20, 112])
/** Oxylink "Plus" firmware has separate vibration and sound switches. */
const OXYLINK_PLUS = new Set(['25010003', '25010004'])
/** SleepU / OxyU: the reminder is on when the motor strength is non-zero. */
const MOTOR_SWITCH_MODELS = new Set([6, 69, 225])

export class LegacySession implements DeviceSession {
  readonly family = 'legacy' as const
  info: DeviceInfo | null = null
  raw: LegacyInfo | null = null
  onDisconnect: () => void = () => {}
  onStatus?: (msg: string) => void
  onWarn?: (msg: string) => void

  private decoder = new LegacyDecoder()
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  /** Whether the device echoes the request's packet number (learned from READ_CONTENT). */
  private pktEcho: 'unknown' | 'yes' | 'no' = 'unknown'
  private lastMotor = 0
  private live: LivePoller

  constructor(
    readonly transport: Transport,
    readonly model: DeviceModel,
  ) {
    transport.onData = (c) => this.onData(c)
    transport.onDisconnect = () => {
      this.closed = true
      this.fail(new DeviceError('Device disconnected'))
      this.onDisconnect()
    }
    const period = model.id === 20 || model.id === 112 ? 1000 : 1500
    this.live = new LivePoller(() => this.pollLive(), () => this.closed, period)
  }

  get busy(): boolean {
    return this.live.busy
  }

  private onData(chunk: Uint8Array) {
    for (const f of this.decoder.push(chunk)) {
      const p = this.pending
      if (!p) continue // unsolicited / late: drop
      // Responses carry no command id; the echoed packet number is the only way
      // to tell a late reply from the current one (as LepuBle checks it).
      if (f.pktNo !== p.pktNo) {
        if (p.pktNo !== 0 && f.pktNo === 0 && this.pktEcho === 'unknown') this.pktEcho = 'no'
        else if (this.pktEcho !== 'no') continue
      } else if (p.pktNo !== 0) {
        this.pktEcho = 'yes'
      }
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

  request(
    cmd: number,
    payload?: Uint8Array,
    opts: { pktNo?: number; timeout?: number; anyStatus?: boolean } = {},
  ): Promise<Uint8Array> {
    const run = () => this.exchange(cmd, payload ?? new Uint8Array(0), opts)
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => {})
    return p
  }

  private async exchange(cmd: number, payload: Uint8Array, opts: { pktNo?: number; timeout?: number; anyStatus?: boolean }) {
    if (!LEGACY_ALLOWED.has(cmd)) throw new DeviceError(`Refusing to send legacy opcode 0x${cmd.toString(16)}`)
    if (this.closed) throw new DeviceError('Not connected')
    const pktNo = opts.pktNo ?? 0
    // Start every exchange from a clean buffer (LepuBle clears its pool before sending).
    this.decoder.reset()
    const reply = new Promise<LegacyFrame>((resolve, reject) => {
      this.pending = {
        pktNo,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = null
          this.decoder.reset()
          reject(new DeviceError(`Timeout waiting for reply to 0x${cmd.toString(16).padStart(2, '0')}`))
        }, opts.timeout ?? 6000),
      }
    })
    try {
      await this.transport.write(encodeLegacy(cmd, payload, pktNo))
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)))
    }
    const f = await reply
    if (f.status !== 0 && !opts.anyStatus) {
      throw new DeviceError(`Device rejected 0x${cmd.toString(16)} (status 0x${f.status.toString(16)})`)
    }
    return f.payload
  }

  async init(opts: { syncTime: boolean }): Promise<void> {
    this.decoder.reset()
    this.onStatus?.('Reading device info…')
    try {
      await this.refreshInfo(2500)
    } catch (e) {
      if (e instanceof DeviceError && /Timeout/.test(e.message)) {
        throw new LegacyNoResponse('The device did not answer on the legacy service')
      }
      throw e
    }
    if (opts.syncTime) {
      try {
        await this.syncTime()
        await this.refreshInfo()
      } catch (e) {
        if (this.closed) throw e
        this.onWarn?.(`Couldn't set the device clock: ${(e as Error).message}`)
      }
    }
  }

  async refreshInfo(timeout?: number): Promise<DeviceInfo> {
    const j = parseLegacyInfo(await this.request(LegacyCmd.INFO, undefined, { timeout }))
    this.raw = j
    const motor = num(j, 'CurMotor')
    if (motor) this.lastMotor = motor
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
    if (!this.raw) await this.refreshInfo()
    const j = this.raw!
    const pct = num(j, 'CurBAT')
    if (pct === undefined) return null
    return { percent: pct, state: BATTERY[num(j, 'CurBatState') ?? 0] ?? 'normal' }
  }

  /** The SDK never checks PARA_SYNC's status, so neither do we. */
  async syncTime(): Promise<void> {
    await this.request(LegacyCmd.PARA_SYNC, paraSyncPayload({ SetTIME: legacyTimeString(new Date()) }), { anyStatus: true })
  }

  async listFiles(): Promise<string[]> {
    await this.refreshInfo()
    return legacyFileList(this.raw ?? {})
  }

  async readFile(name: string, onProgress?: (p: ReadProgress) => void, signal?: AbortSignal): Promise<Uint8Array> {
    return this.live.exclusive(async () => {
      try {
        const start = await this.request(LegacyCmd.READ_START, readStartPayload(name))
        if (start.length < 4) throw new DeviceError('READ_START reply too short')
        const size = (start[0] | (start[1] << 8) | (start[2] << 16) | (start[3] << 24)) >>> 0
        if (size <= 0 || size > 2_000_000) throw new DeviceError(`Unexpected file size ${size}`)
        const out = new Uint8Array(size)
        let got = 0
        let pkt = 0
        while (got < size) {
          if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
          let chunk: Uint8Array | null = null
          for (let attempt = 0; !chunk; attempt++) {
            try {
              chunk = await this.request(LegacyCmd.READ_CONTENT, undefined, { pktNo: pkt })
            } catch (e) {
              // A retry is only safe when replies carry the packet number, so a
              // late answer can't be mistaken for the next block.
              const retryable = e instanceof DeviceError && /Timeout/.test(e.message) && this.pktEcho === 'yes'
              if (!retryable || attempt >= 2) throw e
            }
          }
          if (!chunk.length) throw new DeviceError('Empty file chunk')
          const n = Math.min(chunk.length, size - got)
          out.set(chunk.subarray(0, n), got)
          got += n
          pkt++
          onProgress?.({ done: got, total: size })
        }
        return out
      } finally {
        if (!this.closed) await this.request(LegacyCmd.READ_END).catch(() => {})
      }
    })
  }

  async getSettings(): Promise<SettingDef[]> {
    await this.refreshInfo()
    return legacySettingDefs(this.raw ?? {}, this.model, this.lastMotor)
  }

  async writeSetting(key: string, value: number): Promise<void> {
    const j = this.raw ?? {}
    const sw = switchStyle(this.model, j)
    let params: Record<string, number>
    switch (key) {
      case 'oxiReminder':
        if (sw === 'motor') params = { SetMotor: value ? this.lastMotor || 20 : 0 }
        else if (sw === 'sound') params = { SetOxiSwitch: value ? 2 : 0 }
        else params = { SetOxiSwitch: (value ? 1 : 0) | ((num(j, 'OxiSwitch') ?? 0) & 2) }
        break
      case 'hrReminder':
        if (sw === 'sound') params = { SetHRSwitch: value ? 2 : 0 }
        else params = { SetHRSwitch: (value ? 1 : 0) | ((num(j, 'HRSwitch') ?? 0) & 2) }
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
    await this.live.exclusive(async () => {
      // Status is not checked (as in the SDK); re-reading INFO shows what the device kept.
      await this.request(LegacyCmd.PARA_SYNC, paraSyncPayload(params), { anyStatus: true })
      await this.refreshInfo()
    })
  }

  private async pollLive(): Promise<LiveSample | null> {
    const lead = (on: boolean) => (on || this.model.ignoreLead ? 'ok' : 'no-finger') as LiveSample['sensor']
    const valid = (s: number, p: number) => ![0, 127, 255].includes(s) && ![0, 255, 511, 65535].includes(p)
    if (RT_PARAM_MODELS.has(this.model.id)) {
      const r = parseLegacyRtParam(await this.request(LegacyCmd.RT_PARAM, undefined, { timeout: 3000 }))
      if (!r) return null
      const ok = valid(r.spo2, r.pr)
      return {
        t: Date.now(),
        spo2: ok ? r.spo2 : null,
        pr: ok ? r.pr : null,
        pi: ok && r.piRaw && r.piRaw !== 255 ? r.piRaw / 10 : null,
        motion: r.motion === 255 ? null : r.motion,
        battery: r.battery,
        batteryState: BATTERY[r.batteryState] ?? 'normal',
        sensor: lead(r.leadOn),
        wave: [],
      }
    }
    const w = parseLegacyRtWave(await this.request(LegacyCmd.RT_WAVE, new Uint8Array([0]), { timeout: 3000 }))
    if (!w) return null
    const ok = valid(w.spo2, w.pr)
    return {
      t: Date.now(),
      spo2: ok ? w.spo2 : null,
      pr: ok ? w.pr : null,
      pi: ok && w.piRaw && w.piRaw !== 255 ? w.piRaw / 10 : null,
      motion: null,
      battery: w.battery,
      batteryState: BATTERY[w.batteryState] ?? 'normal',
      sensor: w.state === 0 ? lead(false) : w.state === 1 ? 'ok' : 'fault',
      wave: w.wave,
    }
  }

  startLive(onSample: (s: LiveSample) => void): void {
    this.live.start(onSample)
  }

  stopLive(): Promise<void> {
    return this.live.stop()
  }

  async close(): Promise<void> {
    this.closed = true
    void this.live.stop()
    this.fail(new DeviceError('Closed'))
    await this.transport.close()
  }
}

function versionNumber(v: string | number | undefined): number {
  const n = parseInt(String(v ?? '').replace(/\./g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** How this model encodes its reminder switch (ViHealth BloodOxygenRemindActivity). */
export function switchStyle(model: DeviceModel, j: LegacyInfo): 'bits' | 'sound' | 'motor' {
  if (MOTOR_SWITCH_MODELS.has(model.id)) return 'motor'
  if (SOUND_SWITCH_MODELS.has(model.id)) {
    if (model.id === 10 && OXYLINK_PLUS.has(String(j.BranchCode ?? '').trim())) return 'bits'
    return 'sound'
  }
  return 'bits'
}

/** Old WearO2/Oxylink (< 1.8.10) and Oxyfit (< 1.4.10) firmware treat any non-zero switch as on. */
function soundOn(model: DeviceModel, j: LegacyInfo, v: number): boolean {
  const ver = versionNumber(j.SoftwareVer)
  const old = model.id === 20 || model.id === 112 ? ver > 0 && ver < 1410 : ver > 0 && ver < 1810
  return old ? v > 0 : v > 1
}

function range(a: number, b: number, step: number, unit: string) {
  const out = []
  for (let v = a; v <= b; v += step) out.push({ value: v, label: `${v}${unit}` })
  return out
}

/** Settings offered for legacy devices; only keys the device reports are shown. */
export function legacySettingDefs(j: LegacyInfo, model: DeviceModel, lastMotor = 0): SettingDef[] {
  const defs: SettingDef[] = []
  const has = (k: string) => j[k] !== undefined && j[k] !== ''
  const r = model.legacyRanges ?? {}
  const sw = switchStyle(model, j)
  if (sw === 'motor' && has('CurMotor')) {
    defs.push({ key: 'oxiReminder', label: 'SpO₂ reminder (vibrate)', kind: 'toggle', value: (num(j, 'CurMotor') ?? 0) !== 0 ? 1 : 0 })
  } else if (has('OxiSwitch')) {
    const v = num(j, 'OxiSwitch') ?? 0
    defs.push(
      sw === 'sound'
        ? { key: 'oxiReminder', label: 'SpO₂ reminder in device', kind: 'toggle', value: soundOn(model, j, v) ? 1 : 0 }
        : { key: 'oxiReminder', label: 'SpO₂ reminder (vibrate)', kind: 'toggle', value: v & 1 },
    )
  }
  if (has('CurOxiThr')) {
    const [a, b, s] = r.oxiThr ?? [80, 95, 1]
    defs.push({ key: 'oxiThr', label: 'SpO₂ threshold', kind: 'select', options: range(a, b, s, ' %'), value: num(j, 'CurOxiThr')! })
  }
  if (has('HRSwitch')) {
    const v = num(j, 'HRSwitch') ?? 0
    defs.push(
      sw === 'sound'
        ? { key: 'hrReminder', label: 'Pulse rate reminder in device', kind: 'toggle', value: soundOn(model, j, v) ? 1 : 0 }
        : { key: 'hrReminder', label: 'Pulse rate reminder (vibrate)', kind: 'toggle', value: v & 1 },
    )
  }
  if (has('HRLowThr')) {
    const [a, b, s] = r.hrLow ?? [30, 70, 5]
    defs.push({ key: 'hrLow', label: 'Low pulse rate threshold', kind: 'select', options: range(a, b, s, ' bpm'), value: num(j, 'HRLowThr')! })
  }
  if (has('HRHighThr')) {
    const [a, b, s] = r.hrHigh ?? [70, 200, 5]
    defs.push({ key: 'hrHigh', label: 'High pulse rate threshold', kind: 'select', options: range(a, b, s, ' bpm'), value: num(j, 'HRHighThr')! })
  }
  const levels = r.motor ?? [20, 40, 60, 80, 100]
  const names = ['Weakest', 'Weak', 'Medium', 'Strong', 'Very strong']
  const motor = num(j, 'CurMotor')
  // For SleepU-style models motor 0 means "reminder off"; show the remembered strength instead.
  if (has('CurMotor') && !(sw === 'motor' && motor === 0)) {
    defs.push({
      key: 'motor',
      label: 'Vibration strength',
      kind: 'select',
      options: levels.map((v, i) => ({ value: v, label: names[i] ?? String(v) })),
      value: sw === 'motor' && !motor ? lastMotor : motor!,
    })
  }
  if (has('CurBuzzer') && model.hasBuzzer) {
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
