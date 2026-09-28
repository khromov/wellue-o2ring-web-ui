<script lang="ts">
  import type uPlot from 'uplot'
  import { app } from '../app.svelte'
  import { parseAny } from '../files/parse'
  import { computeStats, type RecordingStats } from '../analysis/stats'
  import UPlot from './UPlot.svelte'

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

  function opts(label: string, color: string) {
    return (width: number): uPlot.Options => ({
      width,
      height: 170,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: true, range: () => [range.from / 1000, range.to / 1000] } },
      axes: [
        { stroke: css('--text-2'), grid: { stroke: css('--border') }, ticks: { stroke: css('--border') } },
        { stroke: css('--text-2'), grid: { stroke: css('--border') }, ticks: { stroke: css('--border') }, size: 44 },
      ],
      series: [
        {},
        {
          label,
          stroke: css(color),
          width: 2,
          points: { show: true, size: 7, fill: css(color) },
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

<section class="card">
  <div class="head">
    <h2>Trends</h2>
    <div class="row">
      <div class="seg" role="group" aria-label="Period">
        {#each ['week', 'month', 'year'] as p}
          <button class:active={period === p} onclick={() => ((period = p as Period), (offset = 0))}>{p[0].toUpperCase() + p.slice(1)}</button>
        {/each}
      </div>
      <button onclick={() => offset--} aria-label="Previous">‹</button>
      <span class="range">{rangeLabel}</span>
      <button onclick={() => offset++} disabled={offset >= 0} aria-label="Next">›</button>
    </div>
  </div>
  {#if inRange.length === 0}
    <p class="muted">No recordings in this period.</p>
  {:else}
    <p class="muted small">{inRange.length} recording{inRange.length > 1 ? 's' : ''}</p>
  {/if}
</section>

{#if inRange.length}
  <div class="grid">
    {#each METRICS as m, i (m.key)}
      <section class="card">
        <h3>{m.label}</h3>
        <UPlot options={optionSets[i]} data={chartData(m.get)} height={170} />
      </section>
    {/each}
  </div>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    border-radius: 0;
  }
  .seg button.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  .range {
    min-width: 11rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 1rem;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  h3 {
    margin-bottom: 0.4rem;
  }
  .small {
    margin: 0.6rem 0 0;
    font-size: 0.85rem;
  }
</style>
