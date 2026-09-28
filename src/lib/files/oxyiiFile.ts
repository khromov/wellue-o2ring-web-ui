// O2Ring S (OxyII) oximetry record file. Layout (little endian), verified on
// real O2Ring S files and against both vendor parsers (Lepu SDK
// OxyIIBleFile, O2 Insight Pro OxiDataController::setData):
//
//   header  0 fileVersion (1), 1 fileType (3 = oximetry), 2..7 reserved,
//           8..9 deviceModel u16
//   samples N x [spo2, pr] or [spo2, pr, flags] (trailer channelType 0 / 1)
//           flags: b0-5 motion, b6 PR reminder, b7 SpO2 reminder
//   trailer (48 B) checkSum u32 (byte sum of everything before the trailer),
//           magic u32 0xDA5A1248, startTime u32 (device-local wall clock as
//           epoch s), size u32 (sample count), interval u8, channelType u8,
//           channelBytes u8, reserved[13], asleepTime u16, avgSpo2, minSpo2,
//           drops3, drops4, pctBelow90, secBelow90 u16, dropsBelow90,
//           o2Score (x10, 255 = n/a), steps u32, avgHr

import { u16le, u32le } from '../protocol/bytes'
import type { Recording } from './recording'

const HEADER = 10
const TRAILER = 48
export const OXYII_MAGIC = 0xda5a1248

/** Trailer checksum: u32 sum of every byte before the trailer. */
export function oxyiiChecksum(buf: Uint8Array, end: number): number {
  let sum = 0
  for (let i = 0; i < end; i++) sum = (sum + buf[i]) >>> 0
  return sum
}

export function isOxyIIFile(buf: Uint8Array): boolean {
  return buf.length >= HEADER + TRAILER && u32le(buf, buf.length - TRAILER + 4) === OXYII_MAGIC
}

/**
 * A recording the ring hasn't finalised yet (it writes the trailer about two
 * minutes after the ring is taken off): header + 3-byte samples, no trailer.
 */
export function isUnfinalisedOxyIIFile(buf: Uint8Array): boolean {
  return (
    !isOxyIIFile(buf) &&
    buf.length >= HEADER &&
    (buf.length - HEADER) % 3 === 0 &&
    buf[0] === 1 &&
    buf[1] === 3 &&
    buf.subarray(2, 8).every((b) => b === 0) &&
    // A finished file cut short still contains the trailer magic somewhere near the end.
    !containsMagic(buf.subarray(Math.max(HEADER, buf.length - 96)))
  )
}

function containsMagic(d: Uint8Array): boolean {
  for (let i = 0; i + 4 <= d.length; i++) {
    if (d[i] === 0x48 && d[i + 1] === 0x12 && d[i + 2] === 0x5a && d[i + 3] === 0xda) return true
  }
  return false
}

/** Parse "yyyyMMddHHmmss" (optionally with a prefix or extension) as local time. */
export function timeFromFileName(name: string | undefined): number | null {
  const m = /(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name ?? '')
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

function parseUnfinalised(buf: Uint8Array, fileName?: string, intervalHint?: number): Recording {
  const n = Math.floor((buf.length - HEADER) / 3)
  const spo2: (number | null)[] = new Array(n)
  const pr: (number | null)[] = new Array(n)
  const motion: (number | null)[] = new Array(n)
  const spo2Alarm: boolean[] = new Array(n)
  const prAlarm: boolean[] = new Array(n)
  for (let i = 0, o = HEADER; i < n; i++, o += 3) {
    const s = buf[o]
    const p = buf[o + 1]
    spo2[i] = s === 0xff || s === 0 || s === 127 || s > 100 ? null : s
    pr[i] = p === 0xff || p === 0 ? null : p
    motion[i] = buf[o + 2] & 0x3f
    prAlarm[i] = !!(buf[o + 2] & 0x40)
    spo2Alarm[i] = !!(buf[o + 2] & 0x80)
  }
  const start = timeFromFileName(fileName)
  if (start === null) throw new Error('Unfinalised recording without a timestamp file name')
  // The interval isn't stored until the trailer is written: use the device's
  // storage interval from when it was downloaded, else the 1 s default.
  const interval = intervalHint && intervalHint > 0 && intervalHint <= 60 ? intervalHint : 1
  return {
    format: 'oxyii-unfinalised',
    start,
    interval,
    spo2,
    pr,
    motion,
    spo2Alarm,
    prAlarm,
    device: { deviceModel: u16le(buf, 8) },
    meta: {
      fileVersion: buf[0],
      fileType: buf[1],
      status: 'unfinalised (no trailer yet; re-download later for device statistics)',
      interval: intervalHint ? `${interval} s (device setting)` : '1 s (assumed)',
    },
  }
}

export function parseOxyIIFile(buf: Uint8Array, fileName?: string, intervalHint?: number): Recording {
  if (isUnfinalisedOxyIIFile(buf)) return parseUnfinalised(buf, fileName, intervalHint)
  if (!isOxyIIFile(buf)) throw new Error('Not an O2Ring S record file (magic missing)')
  if (buf[1] !== 3) throw new Error(`Unsupported OxyII file type ${buf[1]} (only oximetry files are supported)`)
  const T = buf.length - TRAILER
  const channelType = buf[T + 17]
  const rec = channelType === 0 ? 2 : channelType === 1 ? 3 : 0
  if (!rec) throw new Error(`Unknown sample layout (channel type ${channelType})`)
  const deviceModel = u16le(buf, 8)
  const inv = deviceModel === 7 ? 0x00 : 0xff
  const n = Math.floor((T - HEADER) / rec)
  const spo2: (number | null)[] = new Array(n)
  const pr: (number | null)[] = new Array(n)
  const motion: (number | null)[] = new Array(n)
  const spo2Alarm: boolean[] = new Array(n)
  const prAlarm: boolean[] = new Array(n)
  const rawS = new Uint8Array(n)
  const rawP = new Uint16Array(n)
  const rawM = new Uint8Array(n)
  for (let i = 0, o = HEADER; i < n; i++, o += rec) {
    const s = buf[o]
    const p = buf[o + 1]
    // O2 Insight keeps raw values and maps only the invalid marker (PR -> 0xFFFF).
    rawS[i] = s === inv ? 0xff : s
    rawP[i] = p === inv ? 0xffff : p
    rawM[i] = rec === 3 ? buf[o + 2] & 0x3f : 0
    spo2[i] = s === inv || s === 0 || s === 127 || s > 100 ? null : s
    pr[i] = p === inv || p === 0 || p === 255 ? null : p
    const f = rec === 3 ? buf[o + 2] : 0
    motion[i] = f & 0x3f
    prAlarm[i] = !!(f & 0x40)
    spo2Alarm[i] = !!(f & 0x80)
  }
  const checksumOk = u32le(buf, T) === oxyiiChecksum(buf, T)
  const interval = buf[T + 16] || 1
  const o2 = buf[T + 42]
  const avg = buf[T + 34]
  // O2 Insight Pro trusts the trailer summary for deviceModel 4 (O2Ring S);
  // ViHealth always does. Use it when present and plausible.
  const trustSummary = deviceModel === 4 || (avg > 0 && avg <= 100)
  return {
    format: `oxyii-v${buf[0]}`,
    start: localEpochToMs(u32le(buf, T + 8)),
    interval,
    spo2,
    pr,
    motion,
    spo2Alarm,
    prAlarm,
    raw: { spo2: rawS, pr: rawP, motion: rawM },
    device: trustSummary
      ? {
          asleepSec: u16le(buf, T + 32),
          avgSpo2: avg === 255 ? undefined : avg,
          minSpo2: buf[T + 35] === 255 ? undefined : buf[T + 35],
          drops3: buf[T + 36],
          drops4: buf[T + 37],
          pctBelow90: buf[T + 38],
          secBelow90: u16le(buf, T + 39),
          dropsBelow90: buf[T + 41],
          o2Score: o2 === 255 ? null : o2 / 10,
          steps: u32le(buf, T + 43),
          avgHr: buf[T + 47],
          durationSec: u32le(buf, T + 12) * interval,
          deviceModel,
        }
      : { durationSec: u32le(buf, T + 12) * interval, deviceModel },
    meta: {
      fileVersion: buf[0],
      fileType: buf[1],
      deviceModel,
      checksum: checksumOk ? 'OK' : 'mismatch',
      ...(checksumOk ? {} : { warning: 'checksum mismatch: the file may be damaged; device statistics may be wrong' }),
      sampleCount: u32le(buf, T + 12),
      bytesPerSample: rec,
    },
  }
}

/**
 * The ring stores its local wall-clock time as seconds since 1970 "UTC".
 * Re-read those fields as local time so the display matches the ring.
 */
export function localEpochToMs(sec: number): number {
  const d = new Date(sec * 1000)
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  ).getTime()
}
