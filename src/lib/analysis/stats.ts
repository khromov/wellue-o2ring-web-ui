// Report statistics, following O2 Insight Pro's report (OxiDataController /
// ReportHelper): device-computed summary values when the file has them,
// otherwise computed from the samples with the vendor drop algorithm.

import type { Recording } from '../files/recording'
import { computeOdi, type DropEvent } from './odi'

export interface Bucket {
  label: string
  sec: number
  pct: number
}

export interface RecordingStats {
  start: number
  end: number
  durationSec: number
  avgSpo2: number | null
  minSpo2: number | null
  maxSpo2: number | null
  avgPr: number | null
  minPr: number | null
  maxPr: number | null
  drops3: number | null
  drops4: number | null
  /** Drops per hour of recording; null when the recording is shorter than one hour. */
  odi3: number | null
  odi4: number | null
  /** Whether drop counts came from the device (true) or were computed here. */
  dropsFromDevice: boolean
  o2Score: number | null
  secBelow90: number
  pctBelow90: number
  dropsBelow90: number | null
  /** Seconds with a valid SpO2 / PR reading. */
  validSpo2Sec: number
  validPrSec: number
  /** SpO2 >=95, 90-94, <90 */
  spo2Summary: Bucket[]
  /** SpO2 95-100 ... <70 in 5 % bands */
  spo2Bands: Bucket[]
  prBuckets: Bucket[]
  /** >= 4 % drop events found by the vendor algorithm (for chart markers). */
  events4: DropEvent[]
}

export function computeStats(r: Recording): RecordingStats {
  const n = r.spo2.length
  const durationSec = r.device.durationSec || n * r.interval
  let sSum = 0
  let sN = 0
  let sMin = Infinity
  let sMax = -Infinity
  let pSum = 0
  let pN = 0
  let pMin = Infinity
  let pMax = -Infinity
  let below90 = 0
  for (let i = 0; i < n; i++) {
    const s = r.spo2[i]
    if (s !== null) {
      sSum += s
      sN++
      if (s < sMin) sMin = s
      if (s > sMax) sMax = s
      if (s < 90) below90++
    }
    const p = r.pr[i]
    if (p !== null) {
      pSum += p
      pN++
      if (p < pMin) pMin = p
      if (p > pMax) pMax = p
    }
  }
  const dev = r.device
  const odi = computeOdi(r.spo2, r.interval)
  const dropsFromDevice = dev.drops3 !== undefined && dev.drops4 !== undefined
  const drops3 = dropsFromDevice ? dev.drops3! : odi.drops[3]
  const drops4 = dropsFromDevice ? dev.drops4! : odi.drops[4]
  // O2 Insight Pro: drops / total duration * 3600, "Time<1h" under an hour.
  const perHour = (c: number) => (durationSec < 3600 ? null : (c / durationSec) * 3600)

  const validSpo2Sec = sN * r.interval
  const validPrSec = pN * r.interval
  const bucket = (count: (lo: number, hi: number) => number, total: number, totalSec: number, ranges: [string, number, number][]) =>
    ranges.map(([label, lo, hi]) => {
      const f = total ? count(lo, hi) / total : 0
      return { label, sec: f * totalSec, pct: f * 100 }
    })
  const countS = (lo: number, hi: number) => r.spo2.filter((v) => v !== null && v >= lo && v <= hi).length
  const countP = (lo: number, hi: number) => r.pr.filter((v) => v !== null && v >= lo && v <= hi).length

  return {
    start: r.start,
    end: r.start + durationSec * 1000,
    durationSec,
    avgSpo2: dev.avgSpo2 ?? (sN ? Math.trunc(sSum / sN) : null),
    minSpo2: dev.minSpo2 ?? (sN ? sMin : null),
    maxSpo2: sN ? sMax : null,
    avgPr: dev.avgHr && dev.avgHr !== 255 ? dev.avgHr : pN ? Math.trunc(pSum / pN) : null,
    minPr: pN ? pMin : null,
    maxPr: pN ? pMax : null,
    drops3,
    drops4,
    odi3: perHour(drops3),
    odi4: perHour(drops4),
    dropsFromDevice,
    o2Score: dev.o2Score ?? null,
    secBelow90: dev.secBelow90 ?? below90 * r.interval,
    pctBelow90: sN ? (below90 / sN) * 100 : 0,
    dropsBelow90: dev.dropsBelow90 ?? null,
    validSpo2Sec,
    validPrSec,
    spo2Summary: bucket(countS, sN, validSpo2Sec, [
      ['95–100 %', 95, 100],
      ['90–94 %', 90, 94],
      ['< 90 %', 0, 89],
    ]),
    spo2Bands: bucket(countS, sN, validSpo2Sec, [
      ['95–100', 95, 100],
      ['90–94', 90, 94],
      ['85–89', 85, 89],
      ['80–84', 80, 84],
      ['75–79', 75, 79],
      ['70–74', 70, 74],
      ['< 70', 0, 69],
    ]),
    prBuckets: bucket(countP, pN, validPrSec, [
      ['> 120 bpm', 121, 1000],
      ['50–120 bpm', 50, 120],
      ['< 50 bpm', 0, 49],
    ]),
    events4: odi.events[4],
  }
}
