/** A parsed oximetry recording, independent of device family. */
export interface Recording {
  /** Parser that produced this, e.g. 'oxyii-v1'. */
  format: string
  /** Wall-clock start as epoch ms (interpreted in the viewer's timezone). */
  start: number
  /** Seconds between samples. */
  interval: number
  /** Per-sample values; null = invalid / no reading. */
  spo2: (number | null)[]
  pr: (number | null)[]
  motion: (number | null)[]
  /** Samples where the device's SpO2 / PR reminder fired. */
  spo2Alarm?: boolean[]
  prAlarm?: boolean[]
  /**
   * Raw per-sample values as stored (invalid markers included), for exports
   * that must match the vendor software byte for byte.
   */
  raw?: { spo2: ArrayLike<number>; pr: ArrayLike<number>; motion: ArrayLike<number> }
  /** Summary values stored by the device in the file, if any. */
  device: DeviceSummary
  /** Extra raw header fields for the details table. */
  meta: Record<string, string | number>
}

export interface DeviceSummary {
  avgSpo2?: number
  minSpo2?: number
  drops3?: number
  drops4?: number
  pctBelow90?: number
  secBelow90?: number
  dropsBelow90?: number
  o2Score?: number | null
  avgHr?: number
  steps?: number
  asleepSec?: number
  durationSec?: number
  deviceModel?: number
}

export function durationSec(r: Recording): number {
  return r.spo2.length * r.interval
}
