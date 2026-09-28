<script lang="ts">
  import type uPlot from 'uplot'
  import { app } from '../app.svelte'
  import { parseAny } from '../files/parse'
  import { computeStats, type RecordingStats } from '../analysis/stats'
  import UPlot from './UPlot.svelte'
  import Icon from './Icon.svelte'

  type Period = 'week' | 'month' | 'year'
  let period = $state<Period>('month')
  let offset = $state(0)

  // Parse every stored recording once (cached by id + size).
  const cache = new Map<string, RecordingStats | null>()
  const all = $derived.by(() => {
    const out: { id: string; stats: RecordingStats }[] = []
    for (const f of app.files) {
      const key = `${f.id}:${f.bytes.length}`
      if (!cache.has(key)) {
        try {
          cache.set(key, computeStats(parseAny(f.bytes, f.format, f.fileName, f.intervalHint)))
        } catch {
          cache.set(key, null)
        }
      }
      const s = cache.get(key)
      if (s) out.push({ id: f.id, stats: s })
    }
    return out.sort((a, b) => a.stats.start - b.stats.start)
  })

  const range = $derived.by(() => {
    const now = new Date()
    let from: Date
    let to: Date
    if (period === 'week') {
      const day = (now.getDay() + 6) % 7 // Monday = 0
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7)
      to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7)
    } else if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    } else {
      from = new Date(now.getFullYear() + offset, 0, 1)
      to = new Date(from.getFullYear() + 1, 0, 1)
    }
    return { from: from.getTime(), to: to.getTime() }
  })
  const rangeLabel = $derived.by(() => {
    const f = new Date(range.from)
    if (period === 'year') return String(f.getFullYear())
    if (period === 'month') return f.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const t = new Date(range.to - 86400000)
    return `${f.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  })
  const inRange = $derived(all.filter((r) => r.stats.start >= range.from && r.stats.start < range.to))

  function css(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
  }

  const METRICS: { key: string; label: string; color: string; get: (s: RecordingStats) => number | null }[] = [
    { key: 'o2', label: 'O₂ score', color: '--ok', get: (s) => s.o2Score },
    { key: 'd4', label: 'Drops over 4 %', color: '--pr', get: (s) => s.drops4 },
    { key: 'min', label: 'Lowest SpO₂ (%)', color: '--spo2', get: (s) => s.minSpo2 },
    { key: 'avg', label: 'Average SpO₂ (%)', color: '--spo2', get: (s) => s.avgSpo2 },
    { key: 'pr', label: 'Average pulse (bpm)', color: '--pr', get: (s) => s.avgPr },
  ]

  function chartData(get: (s: RecordingStats) => number | null): uPlot.AlignedData {
    return [inRange.map((r) => r.stats.start / 1000), inRange.map((r) => get(r.stats))]
  }

  const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
  const day = (_u: uPlot, splits: number[]) =>
    splits.map((v) => (v == null ? '' : new Date(v * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })))

  function opts(label: string, color: string) {
    return (width: number): uPlot.Options => ({
      width,
      height: 170,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: true, range: () => [range.from / 1000, range.to / 1000] } },
      axes: [
        { stroke: css('--text-2'), font: FONT, grid: { show: false }, ticks: { show: false }, gap: 6, size: 30, space: 56, values: day },
        { stroke: css('--text-2'), font: FONT, grid: { stroke: css('--border') }, ticks: { show: false }, gap: 6, size: 40 },
      ],
      series: [
        {},
        {
          label,
          stroke: css(color),
          width: 2,
          points: { show: true, size: 8, width: 2, stroke: css(color), fill: css('--surface') },
        },
      ],
    })
  }
  // Recreate charts when the range changes (the x-scale range is baked into options).
  const optionSets = $derived.by(() => {
    void range
    return METRICS.map((m) => opts(m.label, m.color))
  })
</script>

<section class="card toolbar-card">
  <div class="head">
    <div class="title">
      <h2>Trends</h2>
      {#if inRange.length}<span class="chip">{inRange.length} recording{inRange.length > 1 ? 's' : ''}</span>{/if}
    </div>
    <div class="controls">
      <div class="seg" role="group" aria-label="Period">
        {#each ['week', 'month', 'year'] as p (p)}
          <button class:active={period === p} aria-pressed={period === p} onclick={() => ((period = p as Period), (offset = 0))}
            >{p[0].toUpperCase() + p.slice(1)}</button
          >
        {/each}
      </div>
      <div class="stepper">
        <button class="ghost icon" onclick={() => offset--} aria-label="Previous"><Icon name="chevron-left" size={18} /></button>
        <span class="range">{rangeLabel}</span>
        <button class="ghost icon" onclick={() => offset++} disabled={offset >= 0} aria-label="Next"
          ><Icon name="chevron-right" size={18} /></button
        >
      </div>
    </div>
  </div>
</section>

{#if inRange.length === 0}
  <section class="card empty">
    <span class="empty-icon"><Icon name="trends" size={22} /></span>
    <p class="empty-title">No recordings in this period.</p>
    <p class="muted">Step back with ‹ to see earlier periods.</p>
  </section>
{:else}
  <div class="grid">
    {#each METRICS as m, i (m.key)}
      <section class="card chart" style="--c: var({m.color})">
        <h3><span class="dot"></span>{m.label}</h3>
        <UPlot options={optionSets[i]} data={chartData(m.get)} height={170} />
      </section>
    {/each}
  </div>
{/if}

<style>
  .toolbar-card {
    padding: 0.8rem 0.9rem 0.8rem 1.25rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 11px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .seg button {
    min-height: 2rem;
    padding: 0 0.9rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .seg button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    border-color: transparent;
    color: var(--text);
  }
  .seg button.active,
  .seg button.active:hover:not(:disabled) {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(16 24 40 / 8%);
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .range {
    min-width: 10.5rem;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .grid > :first-child {
    grid-column: 1 / -1;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .chart {
    padding: 1rem 1.1rem 0.6rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.5rem;
    font-size: var(--fs-sm);
    font-weight: 650;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.3rem;
    padding: 2.6rem 1rem;
  }
  .empty p {
    margin: 0;
  }
  .empty-title {
    font-weight: 600;
    margin-top: 0.4rem !important;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
  }
  @media (max-width: 640px) {
    .controls {
      width: 100%;
      justify-content: space-between;
    }
    .range {
      min-width: 0;
    }
  }
</style>
