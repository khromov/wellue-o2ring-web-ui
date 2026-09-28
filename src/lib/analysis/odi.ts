// Desaturation ("drop") detection, ported from the vendor algorithm
// `odi_alg_func` / `ODI_cal_func` (O2 Insight Pro and libodi-lib.so in
// ViHealth; both decode to the same logic).
//
// For each sample S0 (evaluated with a 10-minute look-ahead) and each
// threshold th in {2,3,4} %:
//  1. Baseline: walk back up to 2 min; every sample must be valid and > S0;
//     the first one >= S0 + th is the baseline.
//  2. Fall rate th / fallTime must be within 0.1..5 %/s.
//  3. Walk forward up to 10 min tracking the nadir; the baseline-to-nadir
//     time must stay within 8..120 s; the event counts when SpO2 climbs back
//     to the baseline within 20 s of the nadir.

export interface DropEvent {
  /** Sample index of the nadir. */
  nadir: number
  /** Sample index where the fall started (baseline). */
  start: number
  /** Sample index where SpO2 was back at baseline. */
  end: number
  baseline: number
  nadirValue: number
}

export interface OdiResult {
  drops: Record<2 | 3 | 4, number>
  events: Record<2 | 3 | 4, DropEvent[]>
  /** Drops per hour of valid data, as the vendor library computes it. */
  index: Record<2 | 3 | 4, number>
}

const THS = [2, 3, 4] as const

export function computeOdi(spo2: (number | null)[], interval: number): OdiResult {
  const iv = Math.max(1, Math.round(interval))
  const perMin = Math.floor(60 / iv)
  const back = 2 * perMin
  const win = 10 * perMin
  const n = spo2.length
  // Raw bytes: invalid samples are 0 (the vendor code treats 0 and >=128 as invalid).
  const v = new Uint8Array(n)
  let validCnt = 0
  for (let i = 0; i < n; i++) {
    const s = spo2[i]
    v[i] = s === null || s <= 0 || s >= 128 ? 0 : s
    if (v[i]) validCnt++
  }
  const valid = (x: number) => x !== 0 && x < 128
  const at = (i: number) => (i >= 0 && i < n ? v[i] : 0)

  const drops = { 2: 0, 3: 0, 4: 0 } as Record<2 | 3 | 4, number>
  const events = { 2: [], 3: [], 4: [] } as Record<2 | 3 | 4, DropEvent[]>
  const lastEnd = { 2: -1, 3: -1, 4: -1 } as Record<2 | 3 | 4, number>

  for (let g = 0; g < n; g++) {
    const s0 = v[g]
    if (!valid(s0)) continue
    for (const th of THS) {
      if (g < lastEnd[th]) continue
      // 1) baseline
      let steps = 0
      let base = -1
      let baseIdx = -1
      for (let k = 1; k <= back; k++) {
        const idx = g - k
        const x = at(idx)
        if (!valid(x) || idx < 0 || idx < lastEnd[th] || x <= s0) break
        steps++
        if (x - s0 >= th) {
          base = x
          baseIdx = idx
          break
        }
      }
      if (base < 0) continue
      const rate = th / (steps * iv)
      if (rate > 5.0 || rate < 0.1) continue
      // 2) forward
      let nadir = s0
      let nadirIdx = g
      let fallDur = steps * iv
      let firstRec = -1
      for (let j = 1; j <= win; j++) {
        const idx = g + j
        const x = at(idx)
        if (!valid(x)) break
        if (x <= nadir) {
          nadir = x
          nadirIdx = idx
          fallDur = (idx - baseIdx) * iv
        }
        if (fallDur < 8 || fallDur > 120) break
        if (x - nadir < th) continue
        if (firstRec < 0) firstRec = idx
        if (x < base) continue
        if ((idx - nadirIdx) * iv >= 20) break
        drops[th]++
        events[th].push({ nadir: nadirIdx, start: baseIdx, end: idx, baseline: base, nadirValue: nadir })
        lastEnd[th] = idx
        break
      }
    }
  }
  const hours = (validCnt * iv) / 3600
  const index = {
    2: hours ? drops[2] / hours : 0,
    3: hours ? drops[3] / hours : 0,
    4: hours ? drops[4] / hours : 0,
  } as Record<2 | 3 | 4, number>
  return { drops, events, index }
}
