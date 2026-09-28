import { describe, expect, it } from 'vitest'
import { computeOdi } from './odi'
import { identifyModel, bleNameFilters } from '../devices/models'

/** Flat 97 % with a dip: fall over `fall` s to `nadir`, hold, recover over `rise` s. */
function withDip(nadir: number, fall = 30, hold = 5, rise = 8, total = 1800) {
  const s: (number | null)[] = new Array(total).fill(97)
  const at = 600
  for (let i = 0; i < fall; i++) s[at + i] = Math.round(97 - ((97 - nadir) * (i + 1)) / fall)
  for (let i = 0; i < hold; i++) s[at + fall + i] = nadir
  for (let i = 0; i < rise; i++) s[at + fall + hold + i] = Math.round(nadir + ((97 - nadir) * (i + 1)) / rise)
  return s
}

describe('vendor drop algorithm', () => {
  it('counts a slow 5 % dip as a 2/3/4 % drop', () => {
    const r = computeOdi(withDip(92), 1)
    expect(r.drops).toEqual({ 2: 1, 3: 1, 4: 1 })
    expect(r.events[4][0].nadirValue).toBe(92)
  })

  it('needs >= 8 s from baseline to nadir at each threshold', () => {
    // 97 -> 92 in 12 s: the 2 % and 3 % steps happen in < 8 s, only 4 % qualifies.
    const r = computeOdi(withDip(92, 12), 1)
    expect(r.drops).toEqual({ 2: 0, 3: 0, 4: 1 })
  })

  it('works on 4 s samples', () => {
    const s: (number | null)[] = new Array(600).fill(97)
    s.splice(200, 6, 95, 93, 92, 92, 95, 97)
    expect(computeOdi(s, 4).drops[4]).toBe(1)
  })

  it('does not count a 2 % dip as 3/4 %', () => {
    const r = computeOdi(withDip(95), 1)
    expect(r.drops[3]).toBe(0)
    expect(r.drops[4]).toBe(0)
  })

  it('rejects dips that do not recover to baseline within 20 s of the nadir', () => {
    const r = computeOdi(withDip(92, 30, 5, 40), 1)
    expect(r.drops[4]).toBe(0)
  })

  it('rejects near-instant falls (> 5 %/s)', () => {
    const s: (number | null)[] = new Array(1800).fill(97)
    for (let i = 600; i < 615; i++) s[i] = 80
    expect(computeOdi(s, 1).drops[4]).toBe(0)
  })

  it('treats an invalid sample inside the event as a gap (no drop)', () => {
    const s = withDip(92)
    s[632] = null // in the nadir hold
    expect(computeOdi(s, 1).drops[4]).toBe(0)
  })
})

describe('device identification by BLE name', () => {
  it.each([
    ['O2Ring S 0541', 'O2Ring S', 'oxyii'],
    ['O2Ring SF 1234', 'O2Ring SF', 'oxyii'],
    ['O2Ring 1A2B', 'O2Ring', 'legacy'],
    ['O2 5C3D', 'Checkme O2', 'legacy'],
    ['O2M 1234', 'Checkme O2 Max', 'legacy'],
    ['SleepU 7788', 'SleepU', 'legacy'],
    ['BabyO2N 1122', 'BabyO2 S2', 'legacy'],
    ['BabyO2 1122', 'BabyO2', 'legacy'],
    ['KidsO2 0001', 'KidsO2', 'legacy'],
    ['S8-AW 1', 'S8-AW', 'oxyii'],
  ])('%s', (name, model, family) => {
    const m = identifyModel(name)
    expect(m?.name).toBe(model)
    expect(m?.family).toBe(family)
  })

  it('returns null for unrelated devices', () => {
    expect(identifyModel('LYWSD03MMC')).toBeNull()
    expect(identifyModel('O2Speaker')).toBeNull()
  })

  it('builds non-redundant name prefix filters', () => {
    const p = bleNameFilters().map((f) => f.namePrefix)
    expect(p).toContain('O2')
    expect(p).not.toContain('O2Ring S')
    expect(p).toContain('SleepU')
  })
})
