// Device session for the OxyII family (O2Ring S, S8-AW, Band-WU, SHQO2Pro,
// O2Ring SF, ...). Mirrors the connect flow of ViHealth's Lepu SDK:
//   FF (auth, <=1 s) -> 10 [00] -> C0 (time) -> 00 -> E1 -> F1 -> F2/F3../F4 -> poll 04

import { OxyIIDecoder, encodeOxyII, type OxyIIFrame } from '../protocol/oxyii'
import {
  ALLOWED_CMDS,
  Cmd,
  ConfigType,
  PKG_ERRORS,
  aesDecrypt,
  aesEncrypt,
  authPayload,
  fileNamePayload,
  parseAuthReply,
  parseBattery,
  parseConfig,
  parseFileList,
  parseInfo,
  parseRtData,
  setConfigPayload,
  timePayload,
  timePayloadNoTz,
  u32Payload,
  type OxyIIConfig,
} from '../protocol/oxyiiMessages'
import type { Transport } from '../transport/types'
import { LivePoller } from './live'
import type { DeviceModel } from './models'
import {
  DeviceError,
  type BatteryInfo,
  type DeviceInfo,
  type DeviceSession,
  type LiveSample,
  type ReadProgress,
  type SettingDef,
} from './types'

/** Replies whose payload is AES-encrypted in an encrypted session (OxyIIBleInterface). */
const ENCRYPTED_REPLIES = new Set<number>([0xe0, 0xe1, 0xe4, 0xf1, 0x06, 0xf2, 0xf3, 0x00, 0x02, 0x11, 0x03, 0x12, 0x04, 0x05, 0x13, 0x14])

interface Pending {
  cmd: number
  seq: number
  resolve: (f: OxyIIFrame) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface RequestOpts {
  timeout?: number
}

/** Largest file we'll accept (O2Ring S files are capped at ~108 kB / 10 h). */
const MAX_FILE = 4 * 1024 * 1024

export class OxyIISession implements DeviceSession {
  readonly family = 'oxyii' as const
  info: DeviceInfo | null = null
  config: OxyIIConfig | null = null
  encrypted = false
  onDisconnect: () => void = () => {}
  onStatus?: (msg: string) => void
  onWarn?: (msg: string) => void

  private decoder = new OxyIIDecoder()
  // seq 1..254: never 0, so a device that always answers seq 0 can't look like it echoes.
  private seq = 1
  private seqEchoed = false
  private aesKey: Uint8Array | null = null
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private live = new LivePoller(
    async () => parseRtData(await this.request(Cmd.RT_DATA, undefined, { timeout: 2500 })),
    () => this.closed,
  )

  constructor(
    readonly transport: Transport,
    readonly model: DeviceModel,
  ) {
    transport.onData = (c) => this.onData(c)
    transport.onDisconnect = () => {
      this.closed = true
      this.failPending(new DeviceError('Device disconnected'))
      this.onDisconnect()
    }
  }

  get busy(): boolean {
    return this.live.busy
  }

  private onData(chunk: Uint8Array) {
    for (const f of this.decoder.push(chunk)) {
      const p = this.pending
      // The O2Ring S echoes seq; once seen, use it to drop late replies.
      if (p && f.cmd === p.cmd && (f.seq === p.seq || !this.seqEchoed)) {
        if (f.seq === p.seq) this.seqEchoed = true
        clearTimeout(p.timer)
        this.pending = null
        p.resolve(f)
      }
      // Anything else (late replies, 0x11-0x14 pushes) is dropped.
    }
  }

  private failPending(e: Error) {
    const p = this.pending
    if (!p) return
    clearTimeout(p.timer)
    this.pending = null
    p.reject(e)
  }

  /** Send one command and wait for its reply. Commands are strictly serialized. */
  request(cmd: number, payload: Uint8Array = new Uint8Array(0), opts: RequestOpts = {}): Promise<Uint8Array> {
    const run = () => this.exchange(cmd, payload, opts)
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => {})
    return p
  }

  private async exchange(cmd: number, payload: Uint8Array, opts: RequestOpts): Promise<Uint8Array> {
    if (!ALLOWED_CMDS.has(cmd)) throw new DeviceError(`Refusing to send opcode 0x${cmd.toString(16)}`)
    if (this.closed) throw new DeviceError('Not connected')
    let body = payload
    // Auth and echo are always plaintext; empty payloads are never encrypted.
    if (this.aesKey && body.length > 0 && cmd !== Cmd.AUTH && cmd !== Cmd.ECHO) body = aesEncrypt(this.aesKey, body)
    const seq = this.seq
    this.seq = this.seq >= 254 ? 1 : this.seq + 1
    const frame = encodeOxyII(cmd, body, seq)
    const timeout = opts.timeout ?? 3000
    const reply = new Promise<OxyIIFrame>((resolve, reject) => {
      this.pending = {
        cmd,
        seq,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = null
          // Drop any half-received frame so it can't stall the next reply.
          this.decoder.reset()
          reject(new DeviceError(`Timeout waiting for reply to 0x${cmd.toString(16).padStart(2, '0')}`))
        }, timeout),
      }
    })
    try {
      await this.transport.write(frame)
    } catch (e) {
      this.failPending(e instanceof Error ? e : new Error(String(e)))
    }
    const f = await reply
    if (f.flag !== 1) {
      const why = PKG_ERRORS[f.flag] ?? `error 0x${f.flag.toString(16)}`
      throw new DeviceError(`Device rejected 0x${cmd.toString(16).padStart(2, '0')}: ${why}`)
    }
    let out = f.payload
    if (this.aesKey && out.length > 0 && out.length % 16 === 0 && ENCRYPTED_REPLIES.has(cmd)) {
      out = aesDecrypt(this.aesKey, out)
    }
    return out
  }

  async init(opts: { syncTime: boolean }): Promise<void> {
    this.decoder.reset()
    if (this.model.oxyiiAuth !== false) {
      this.onStatus?.('Authenticating…')
      try {
        const reply = await this.request(Cmd.AUTH, authPayload(Math.floor(Date.now() / 1000)), { timeout: 1000 })
        const key = parseAuthReply(reply)
        if (key) {
          this.aesKey = key
          this.encrypted = true
        }
      } catch {
        // No reply within 1 s: the vendor app carries on in plaintext.
      }
    }
    // Optional steps: the vendor apps only log failures here.
    try {
      await this.request(Cmd.AUTO_RT_SWITCH, new Uint8Array([0]))
    } catch (e) {
      if (this.closed) throw e
      this.onWarn?.(`Couldn't turn off automatic live data: ${(e as Error).message}`)
    }
    if (opts.syncTime) {
      try {
        await this.syncTime()
      } catch (e) {
        if (this.closed) throw e
        this.onWarn?.(`Couldn't set the device clock: ${(e as Error).message}`)
      }
    }
    this.onStatus?.('Reading settings…')
    try {
      this.config = parseConfig(await this.request(Cmd.GET_CONFIG))
    } catch (e) {
      console.warn('GET_CONFIG failed', e)
    }
    this.onStatus?.('Reading device info…')
    await this.refreshInfo()
  }

  async refreshInfo(): Promise<DeviceInfo> {
    const info = parseInfo(await this.request(Cmd.GET_INFO))
    info.model = this.model.name
    info.modelId = this.model.id
    if (this.encrypted) info.extra.session = 'AES encrypted'
    this.info = info
    return info
  }

  async getBattery(): Promise<BatteryInfo | null> {
    return parseBattery(await this.request(Cmd.GET_BATTERY))
  }

  /** ViHealth uses 0xC0 (with timezone); O2 Insight Pro uses 0xEC. Try both. */
  async syncTime(): Promise<void> {
    try {
      await this.request(Cmd.SET_UTC_TIME, timePayload(new Date()))
    } catch (e) {
      if (!(e instanceof DeviceError) || /Timeout|disconnected|Not connected/.test(e.message)) throw e
      await this.request(Cmd.SET_TIME, timePayloadNoTz(new Date()))
    }
  }

  async listFiles(): Promise<string[]> {
    return parseFileList(await this.request(Cmd.GET_FILE_LIST, undefined, { timeout: 5000 }))
  }

  async readFile(name: string, onProgress?: (p: ReadProgress) => void, signal?: AbortSignal): Promise<Uint8Array> {
    return this.live.exclusive(async () => {
      try {
        const start = await this.request(Cmd.READ_FILE_START, fileNamePayload(name), { timeout: 5000 })
        if (start.length < 4) throw new DeviceError('READ_FILE_START reply too short')
        const size = (start[0] | (start[1] << 8) | (start[2] << 16) | (start[3] << 24)) >>> 0
        if (size === 0) throw new DeviceError(`The device reported ${name} as empty`)
        if (size > MAX_FILE) throw new DeviceError(`Implausible file size ${size} for ${name}`)
        const out = new Uint8Array(size)
        let offset = 0
        while (offset < size) {
          if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
          let chunk: Uint8Array | null = null
          // Retrying the same offset is safe: late replies are dropped by seq.
          for (let attempt = 0; attempt < 3 && !chunk; attempt++) {
            try {
              chunk = await this.request(Cmd.READ_FILE_DATA, u32Payload(offset), { timeout: 6000 })
            } catch (e) {
              if (attempt === 2 || !(e instanceof DeviceError) || !/Timeout/.test(e.message)) throw e
            }
          }
          if (!chunk || chunk.length === 0) throw new DeviceError('Empty file chunk')
          const n = Math.min(chunk.length, size - offset)
          out.set(chunk.subarray(0, n), offset)
          offset += n
          onProgress?.({ done: offset, total: size })
        }
        return out
      } finally {
        // Always close the file on the device (both vendor apps do), or later reads can wedge.
        if (!this.closed) await this.request(Cmd.READ_FILE_END).catch(() => {})
      }
    })
  }

  async getSettings(): Promise<SettingDef[]> {
    this.config = parseConfig(await this.request(Cmd.GET_CONFIG))
    return oxyiiSettingDefs(this.config, this.model)
  }

  async writeSetting(key: string, value: number): Promise<void> {
    const c = this.config
    let type: number
    let v = value
    switch (key) {
      case 'spo2Vibrate':
        type = ConfigType.SPO2_SWITCH
        v = (value ? 1 : 0) | (c?.spo2Sound ? 2 : 0)
        break
      case 'hrVibrate':
        // Written in bits 0/1 of its own slot, although GET reports bits 4/5.
        type = ConfigType.HR_SWITCH
        v = (value ? 1 : 0) | (c?.hrSound ? 2 : 0)
        break
      case 'spo2Low':
        type = ConfigType.SPO2_LOW
        break
      case 'hrLow':
        type = ConfigType.HR_LOW
        break
      case 'hrHigh':
        type = ConfigType.HR_HIGH
        break
      case 'motor':
        type = ConfigType.MOTOR
        break
      case 'buzzer':
        type = ConfigType.BUZZER
        break
      case 'displayMode':
        type = ConfigType.DISPLAY_MODE
        break
      case 'brightness':
        type = ConfigType.BRIGHTNESS
        break
      case 'interval':
        type = ConfigType.INTERVAL
        break
      default:
        throw new DeviceError(`Unknown setting ${key}`)
    }
    await this.live.exclusive(async () => {
      await this.request(Cmd.SET_CONFIG, setConfigPayload(type, v))
      this.config = parseConfig(await this.request(Cmd.GET_CONFIG))
    })
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
    this.failPending(new DeviceError('Closed'))
    await this.transport.close()
  }
}

export function oxyiiSettingDefs(c: OxyIIConfig, model: DeviceModel): SettingDef[] {
  const range = (a: number, b: number, step: number, unit: string) => {
    const out = []
    for (let v = a; v <= b; v += step) out.push({ value: v, label: `${v}${unit}` })
    return out
  }
  // Dual-protocol legacy devices running OxyII keep their own ranges and scales.
  const r = model.legacyRanges ?? {}
  const [sa, sb, ss] = r.oxiThr ?? [80, 95, 1]
  const [la, lb, ls] = r.hrLow ?? [30, 70, 5]
  const [ha, hb, hs] = r.hrHigh ?? [70, 200, 5]
  const motorLevels = r.motor ?? [20, 40, 60, 80, 100]
  const defs: SettingDef[] = [
    {
      key: 'spo2Vibrate',
      label: 'SpO₂ reminder (vibrate)',
      kind: 'toggle',
      value: c.spo2Vibrate ? 1 : 0,
      help: 'Vibrate when SpO₂ falls below the threshold.',
    },
    {
      key: 'spo2Low',
      label: 'SpO₂ threshold',
      kind: 'select',
      options: range(sa, sb, ss, ' %'),
      value: c.spo2Low,
      help: 'Thresholds below 85 % are not recommended.',
    },
    { key: 'hrVibrate', label: 'Pulse rate reminder (vibrate)', kind: 'toggle', value: c.hrVibrate ? 1 : 0 },
    { key: 'hrLow', label: 'Low pulse rate threshold', kind: 'select', options: range(la, lb, ls, ' bpm'), value: c.hrLow },
    { key: 'hrHigh', label: 'High pulse rate threshold', kind: 'select', options: range(ha, hb, hs, ' bpm'), value: c.hrHigh },
    {
      key: 'motor',
      label: 'Vibration strength',
      kind: 'select',
      options: motorLevels.map((value, i) => ({ value, label: ['Weakest', 'Weak', 'Medium', 'Strong', 'Very strong'][i] ?? String(value) })),
      value: c.motor,
    },
  ]
  if (model.hasBuzzer) {
    defs.push({
      key: 'buzzer',
      label: 'Reminder volume',
      kind: 'select',
      options: [
        { value: 20, label: 'Very low' },
        { value: 40, label: 'Low' },
        { value: 60, label: 'Medium' },
        { value: 80, label: 'High' },
        { value: 100, label: 'Maximum' },
      ],
      value: c.buzzer,
    })
  }
  defs.push(
    {
      key: 'displayMode',
      label: 'Screen mode',
      kind: 'select',
      options: [
        { value: 0, label: 'Standard' },
        { value: 2, label: 'Always on' },
      ],
      value: c.displayMode,
    },
    {
      key: 'brightness',
      label: 'Screen brightness',
      kind: 'select',
      options: [
        { value: 0, label: 'Low' },
        { value: 1, label: 'Medium' },
        { value: 2, label: 'High' },
      ],
      value: c.brightness,
    },
    {
      key: 'interval',
      label: 'Storage interval',
      kind: 'select',
      options: [
        { value: 1, label: '1 s' },
        { value: 4, label: '4 s' },
      ],
      value: c.interval,
      help: '1 s is recommended. Takes effect from the next recording.',
    },
  )
  // Keep values the device reports even if they are not in our option list.
  for (const d of defs) {
    if (d.kind === 'select' && d.options && !d.options.some((o) => o.value === d.value)) {
      d.options = [...d.options, { value: d.value, label: `${d.value} (device value)` }]
    }
  }
  return defs
}
