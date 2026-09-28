// Legacy Viatom oximeter protocol (original O2Ring, Checkme O2, SleepU,
// Oxylink, KidsO2, BabyO2, O2M, ...). Source: Lepu SDK OxyBleCmd /
// OxyBleResponse / OxyCommonBleInterface in ViHealth, and the first-gen
// path in O2 Insight Pro.
//
// Request:  AA | cmd | ~cmd | pktNo u16 | len u16 | payload | crc8
// Response: 55 | status | ~status | pktNo u16 | len u16 | payload | crc8
// Responses carry no command byte, so commands must be strictly serialized.

import { crc8 } from './crc8'

export const LegacyCmd = {
  READ_START: 0x03,
  READ_CONTENT: 0x04,
  READ_END: 0x05,
  INFO: 0x14,
  PING: 0x15,
  PARA_SYNC: 0x16,
  RT_PARAM: 0x17,
  RT_WAVE: 0x1b,
} as const

/** Never send: 0x18 factory reset (wipes records), 0x19/0x1A factory programming. */
export const LEGACY_ALLOWED = new Set<number>(Object.values(LegacyCmd))

export interface LegacyFrame {
  status: number
  pktNo: number
  payload: Uint8Array
}

export function encodeLegacy(cmd: number, payload: Uint8Array = new Uint8Array(0), pktNo = 0): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  out[0] = 0xaa
  out[1] = cmd & 0xff
  out[2] = ~cmd & 0xff
  out[3] = pktNo & 0xff
  out[4] = (pktNo >> 8) & 0xff
  out[5] = payload.length & 0xff
  out[6] = (payload.length >> 8) & 0xff
  out.set(payload, 7)
  out[out.length - 1] = crc8(out, 0, out.length - 1)
  return out
}

export class LegacyDecoder {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): LegacyFrame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    this.buf = merged
    const frames: LegacyFrame[] = []
    let i = 0
    while (this.buf.length - i >= 8) {
      const b = this.buf
      if (b[i] !== 0x55 || ((b[i + 1] ^ b[i + 2]) & 0xff) !== 0xff) {
        i++
        continue
      }
      const len = b[i + 5] | (b[i + 6] << 8)
      if (this.buf.length - i < 8 + len) break
      const end = i + 8 + len
      if (crc8(b, i, end - 1) !== b[end - 1]) {
        i++
        continue
      }
      frames.push({ status: b[i + 1], pktNo: b[i + 3] | (b[i + 4] << 8), payload: b.slice(i + 7, i + 7 + len) })
      i = end
    }
    this.buf = this.buf.slice(i)
    return frames
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }
}

/** INFO JSON; values may be strings or numbers. */
export type LegacyInfo = Record<string, string | number>

export function parseLegacyInfo(payload: Uint8Array): LegacyInfo {
  const text = new TextDecoder().decode(payload)
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('INFO reply is not JSON')
  // Some firmware pads with NULs or control chars.
  return JSON.parse(text.slice(a, b + 1).replace(/[\u0000-\u001f]/g, ''))
}

export function legacyFileList(info: LegacyInfo): string[] {
  const raw = String(info.FileList ?? '')
  if (raw.length < 3) return []
  return raw
    .replace(/[[\]\s]/g, '')
    .split(',')
    .filter(Boolean)
}

export function num(info: LegacyInfo, key: string): number | undefined {
  const v = info[key]
  if (v === undefined || v === '') return undefined
  const n = parseInt(String(v).replace('%', ''), 10)
  return Number.isFinite(n) ? n : undefined
}

/** SetTIME value: "yyyy-MM-dd,HH:mm:ss" local time. */
export function legacyTimeString(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())},${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** PARA_SYNC payload: compact JSON with string values. */
export function paraSyncPayload(params: Record<string, string | number>): Uint8Array {
  const obj: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) obj[k] = String(v)
  return new TextEncoder().encode(JSON.stringify(obj))
}

export function readStartPayload(name: string): Uint8Array {
  const b = new TextEncoder().encode(name)
  const out = new Uint8Array(b.length + 1)
  out.set(b)
  return out
}

export interface LegacyRt {
  spo2: number
  pr: number
  steps: number
  battery: number
  batteryState: number
  motion: number
  piRaw: number
  leadOn: boolean
}

/** RT_PARAM 0x17 (>= 12 bytes). */
export function parseLegacyRtParam(d: Uint8Array): LegacyRt | null {
  if (d.length < 12) return null
  return {
    spo2: d[0],
    pr: d[1] | (d[2] << 8),
    steps: (d[3] | (d[4] << 8) | (d[5] << 16) | (d[6] << 24)) >>> 0,
    battery: d[7],
    batteryState: d[8],
    motion: d[9],
    piRaw: d[10],
    leadOn: !!(d[11] & 1),
  }
}

/** RT_WAVE 0x1B: values + pleth. Returns null when there's no data. */
export function parseLegacyRtWave(d: Uint8Array): { spo2: number; pr: number; battery: number; batteryState: number; piRaw: number; state: number; wave: number[] } | null {
  if (d.length < 12) return null
  const n = Math.min(d[10] | (d[11] << 8), d.length - 12)
  const raw = Array.from(d.subarray(12, 12 + n))
  const isMarker = (v: number) => v === 156 || v === 246
  const wave = raw.slice()
  for (let i = 0; i < raw.length; i++) {
    if (!isMarker(raw[i])) continue
    const prev = i > 0 ? wave[i - 1] : undefined
    const next = raw.slice(i + 1).find((v) => !isMarker(v))
    wave[i] = prev !== undefined && next !== undefined ? (prev + next) >> 1 : (prev ?? next ?? 0)
  }
  return { spo2: d[0], pr: d[1] | (d[2] << 8), battery: d[3], batteryState: d[4], piRaw: d[5], state: d[6], wave }
}
