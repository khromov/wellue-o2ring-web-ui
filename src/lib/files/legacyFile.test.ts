import { describe, expect, it } from 'vitest'
import { isLegacyFile, parseLegacyFile } from './legacyFile'
import { sniffFormat } from './parse'
import { recordingToCsv, o2InsightTime } from './csv'

export function makeLegacyFile(records: [number, number, number, number][], opts: { version?: number; duration?: number } = {}) {
  const buf = new Uint8Array(40 + 5 * records.length)
  const dv = new DataView(buf.buffer)
  buf[0] = opts.version ?? 3
  dv.setUint16(2, 2024, true)
  buf.set([1, 2, 22, 30, 5], 4)
  dv.setUint32(9, buf.length, true)
  dv.setUint16(13, opts.duration ?? records.length * 4, true)
  buf[17] = 96
  buf[18] = 89
  buf[19] = 4
  buf[20] = 2
  dv.setUint16(22, 30, true)
  buf[24] = 1
  buf[25] = 95
  records.forEach(([s, p, m, f], i) => {
    const o = 40 + 5 * i
    buf[o] = s
    dv.setUint16(o + 1, p, true)
    buf[o + 3] = m
    buf[o + 4] = f
  })
  return buf
}

describe('legacy record file', () => {
  it('parses header and 5-byte records', () => {
    const buf = makeLegacyFile([
      [97, 60, 0, 0],
      [0xff, 0xffff, 0, 0],
      [88, 72, 5, 0x80],
      [95, 180, 0, 0x40],
    ])
    expect(isLegacyFile(buf)).toBe(true)
    expect(sniffFormat(buf)).toBe('legacy')
    const r = parseLegacyFile(buf)
    expect(r.interval).toBe(4)
    expect(r.spo2).toEqual([97, null, 88, 95])
    expect(r.pr).toEqual([60, null, 72, 180])
    expect(r.motion).toEqual([0, 0, 5, 0])
    expect(r.spo2Alarm).toEqual([false, false, true, false])
    expect(r.prAlarm).toEqual([false, false, false, true])
    const d = new Date(r.start)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2024, 0, 2, 22, 30, 5])
    expect(r.device).toMatchObject({ avgSpo2: 96, minSpo2: 89, drops3: 4, drops4: 2, secBelow90: 30, o2Score: 9.5 })
  })

  it('derives 2 s interval for older file versions', () => {
    const r = parseLegacyFile(makeLegacyFile([[97, 60, 0, 0]], { version: 2, duration: 7 }))
    expect(r.interval).toBe(2)
  })
})

describe('CSV export (O2 Insight Pro format)', () => {
  it('matches the vendor header and row format', () => {
    const r = parseLegacyFile(
      makeLegacyFile([
        [97, 60, 3, 0],
        [0xff, 0xffff, 0, 0x80],
      ]),
    )
    const lines = recordingToCsv(r).trim().split('\n')
    expect(lines[0]).toBe('Time,Oxygen Level(%),Pulse Rate(bpm),Motion,Oxygen Level Reminder,PR Reminder,')
    expect(lines[1]).toBe('"10:30:05PM Jan 2, 2024",97,60,3,0,0,')
    expect(lines[2]).toBe('"10:30:09PM Jan 2, 2024",255,65535,0,1,0,')
  })

  it('formats midnight and noon like Qt hh:mm:ssAP', () => {
    expect(o2InsightTime(new Date(2026, 8, 16, 0, 5, 9).getTime())).toBe('12:05:09AM Sep 16, 2026')
    expect(o2InsightTime(new Date(2026, 8, 16, 12, 0, 0).getTime())).toBe('12:00:00PM Sep 16, 2026')
  })
})
