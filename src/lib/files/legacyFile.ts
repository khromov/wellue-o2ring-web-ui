// Legacy oximetry record file (original O2Ring, Checkme O2, SleepU, Oxylink,
// KidsO2, BabyO2, O2M, WearO2, ...). Lepu SDK OxyBleFile / O2 Insight Pro
// OxiDataController (old format). Little endian:
//
//   0 version, 1 mode, 2 year u16, 4 month, 5 day, 6 hour, 7 min, 8 sec
//   9 size u32 (whole file), 13 recordingTime u16 (s), 15 asleepTime u16,
//   17 avgSpo2, 18 minSpo2, 19 drops3, 20 drops4, 21 asleepPct,
//   22 secBelow90 u16, 24 dropsBelow90, 25 o2Score x10, 26 steps u32,
//   30..39 reserved, 40.. records of 5 bytes:
//   spo2, pr u16, motion, flags (0x80 SpO2 reminder, 0x40 PR reminder, 0x20 motion)

import { u16le, u32le } from '../protocol/bytes'
import type { Recording } from './recording'

const HEADER = 40

export function isLegacyFile(buf: Uint8Array): boolean {
  if (buf.length < HEADER + 5) return false
  const y = u16le(buf, 2)
  const [mo, d, h, mi, s] = [buf[4], buf[5], buf[6], buf[7], buf[8]]
  const dur = u16le(buf, 13)
  return (
    y >= 2010 &&
    y <= 2100 &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= 31 &&
    h < 24 &&
    mi < 60 &&
    s < 60 &&
    dur > 0 &&
    buf[1] === 0
  )
}

export function parseLegacyFile(buf: Uint8Array): Recording {
  if (buf.length < HEADER) throw new Error('File too short for a legacy O2 record')
  const version = buf[0]
  const start = new Date(u16le(buf, 2), buf[4] - 1, buf[5], buf[6], buf[7], buf[8]).getTime()
  const declared = u32le(buf, 9)
  const duration = u16le(buf, 13)
  // Read every record in the file (OSCAR). Older v3 files at "2 s" repeat every
  // sample twice and their header size counts only the distinct samples.
  let n = Math.floor((buf.length - HEADER) / 5)
  let stride = 1
  if (version === 3 && n >= 2 && n % 2 === 0 && Math.round(duration / n) === 2) {
    let dup = true
    for (let i = 0; i < n && dup; i += 2) {
      const a = HEADER + 5 * i
      for (let k = 0; k < 5; k++) if (buf[a + k] !== buf[a + 5 + k]) dup = false
    }
    if (dup) {
      n /= 2
      stride = 2
    }
  }
  const spo2: (number | null)[] = new Array(n)
  const pr: (number | null)[] = new Array(n)
  const motion: (number | null)[] = new Array(n)
  const spo2Alarm: boolean[] = new Array(n)
  const prAlarm: boolean[] = new Array(n)
  const rawS = new Uint8Array(n)
  const rawP = new Uint16Array(n)
  const rawM = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = HEADER + 5 * i * stride
    const s = buf[o]
    const p = buf[o + 1] | (buf[o + 2] << 8)
    rawS[i] = s
    rawP[i] = p
    rawM[i] = buf[o + 3]
    spo2[i] = s === 0 || s === 127 || s === 255 || s > 100 ? null : s
    pr[i] = p === 0 || p === 255 || p === 511 || p === 65535 || p > 300 ? null : p
    motion[i] = buf[o + 3] === 255 ? null : buf[o + 3]
    spo2Alarm[i] = !!(buf[o + 4] & 0x80)
    // 0x40 = PR reminder; 0x20 is the motion reminder (Lepu SDK OxyBleFile, O2 Insight CSV).
    prAlarm[i] = !!(buf[o + 4] & 0x40)
  }
  // The file doesn't store the interval; derive it like ViHealth.
  let interval = n ? Math.round(duration / n) : 4
  if (![1, 2, 4].includes(interval)) interval = version === 3 ? 4 : 2
  const o2 = buf[25]
  const z = (v: number) => (v === 255 ? undefined : v)
  return {
    format: `legacy-v${version}`,
    start,
    interval,
    spo2,
    pr,
    motion,
    spo2Alarm,
    prAlarm,
    raw: { spo2: rawS, pr: rawP, motion: rawM },
    device: {
      avgSpo2: z(buf[17]),
      minSpo2: z(buf[18]),
      drops3: buf[19],
      drops4: buf[20],
      secBelow90: u16le(buf, 22),
      dropsBelow90: buf[24],
      o2Score: o2 === 255 ? null : o2 / 10,
      steps: u32le(buf, 26),
      asleepSec: u16le(buf, 15),
      durationSec: duration,
    },
    meta: {
      fileVersion: version,
      mode: buf[1],
      declaredSize: declared,
      ...(stride === 2 ? { note: 'duplicated 2 s samples merged (4 s data)' } : {}),
      recordingTime: `${duration} s`,
      asleepPercent: buf[21],
      records: n,
    },
  }
}
