import { describe, expect, it } from 'vitest'
import { isOxyIIFile, oxyiiChecksum, parseOxyIIFile } from './oxyiiFile'
import { computeStats } from '../analysis/stats'

/** Build a synthetic OxyII file following the OxyIIBleFile layout. */
export function makeOxyIIFile(samples: [number, number, number][], opts: { start?: Date; interval?: number } = {}) {
  const n = samples.length
  const buf = new Uint8Array(10 + 3 * n + 48)
  const dv = new DataView(buf.buffer)
  buf[0] = 1
  buf[1] = 3
  dv.setUint16(8, 4, true)
  samples.forEach(([s, p, f], i) => buf.set([s, p, f], 10 + 3 * i))
  const T = 10 + 3 * n
  const start = opts.start ?? new Date(Date.UTC(2026, 8, 27, 23, 1, 2))
  dv.setUint32(T + 8, start.getTime() / 1000, true)
  dv.setUint32(T + 12, n, true)
  buf[T + 16] = opts.interval ?? 4
  buf[T + 17] = 1
  buf[T + 18] = 3
  dv.setUint16(T + 32, 3600, true)
  buf[T + 34] = 95
  buf[T + 35] = 88
  buf[T + 36] = 7
  buf[T + 37] = 3
  buf[T + 38] = 2
  dv.setUint16(T + 39, 120, true)
  buf[T + 41] = 1
  buf[T + 42] = 93
  buf[T + 47] = 60
  dv.setUint32(T + 4, 0xda5a1248, true)
  dv.setUint32(T, oxyiiChecksum(buf, T), true)
  return buf
}

describe('OxyII record file', () => {
  it('parses samples, flags and trailer', () => {
    const buf = makeOxyIIFile([
      [97, 60, 0x00],
      [96, 61, 0x05 | 0x80],
      [0xff, 0xff, 0x00],
      [89, 70, 0x40],
    ])
    expect(isOxyIIFile(buf)).toBe(true)
    const r = parseOxyIIFile(buf)
    expect(r.interval).toBe(4)
    expect(r.spo2).toEqual([97, 96, null, 89])
    expect(r.pr).toEqual([60, 61, null, 70])
    expect(r.motion).toEqual([0, 5, 0, 0])
    expect(r.spo2Alarm).toEqual([false, true, false, false])
    expect(r.prAlarm).toEqual([false, false, false, true])
    // Device local wall clock 2026-09-27 23:01:02 displayed as local time.
    const d = new Date(r.start)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([
      2026, 8, 27, 23, 1, 2,
    ])
    expect(r.meta.checksum).toBe('OK')
    expect(r.device).toMatchObject({ avgSpo2: 95, minSpo2: 88, drops3: 7, drops4: 3, o2Score: 9.3, avgHr: 60 })
  })

  it('computes stats like the vendor detail screen', () => {
    const samples: [number, number, number][] = []
    for (let i = 0; i < 1000; i++) samples.push([i < 100 ? 89 : 96, i < 10 ? 0 : 60 + (i % 3), 0])
    const s = computeStats(parseOxyIIFile(makeOxyIIFile(samples)))
    expect(s.durationSec).toBe(4000)
    expect(s.avgSpo2).toBe(95) // from trailer
    expect(s.maxSpo2).toBe(96)
    expect(s.drops4).toBe(3)
    expect(s.odi4).toBeCloseTo((3 / 4000) * 3600, 5)
    expect(s.o2Score).toBe(9.3)
    expect(s.avgPr).toBe(60) // trailer avgHr
    expect(s.minPr).toBe(60)
    expect(s.maxPr).toBe(62)
    expect(s.spo2Summary[0].pct).toBeCloseTo(90)
    expect(s.spo2Summary[2].sec).toBeCloseTo(400)
    expect(s.dropsFromDevice).toBe(true)
  })

  it('rejects files without the trailer magic', () => {
    expect(isOxyIIFile(new Uint8Array(59))).toBe(false)
    expect(() => parseOxyIIFile(new Uint8Array(59))).toThrow()
  })

  it('reports a checksum mismatch', () => {
    const buf = makeOxyIIFile([[97, 60, 0]])
    buf[10] = 96
    expect(parseOxyIIFile(buf).meta.checksum).toBe('mismatch')
  })
})
