<script lang="ts">
  import type uPlot from 'uplot'
  import { app, refreshStoredFiles } from '../app.svelte'
  import { updateFile, type PatientInfo, type StoredFile } from '../storage'
  import { parseAny } from '../files/parse'
  import { computeStats } from '../analysis/stats'
  import { download, exportBaseName, fmtTime, recordingToCsv } from '../files/csv'
  import { fmtDur, fmtHeight, fmtWeight, bmi } from './format'
  import UPlot from './UPlot.svelte'
  import PatientDialog from './PatientDialog.svelte'
  import Icon from './Icon.svelte'
  import Dur from './Dur.svelte'

  let { file }: { file: StoredFile } = $props()

  const parsed = $derived.by(() => {
    try {
      return { rec: parseAny(file.bytes, file.format, file.fileName, file.intervalHint), error: '' }
    } catch (e) {
      return { rec: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const rec = $derived(parsed.rec)
  const stats = $derived(rec ? computeStats(rec) : null)
  const patient = $derived(file.patient ?? {})
  const hasPatient = $derived(Object.values(patient).some((v) => v !== undefined && v !== ''))

  let editing = $state(false)
  // The component is keyed by file id, so the initial value is all we need.
  // svelte-ignore state_referenced_locally
  let remark = $state(file.note ?? '')

  function css(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
  }

  const xs = $derived(rec ? rec.spo2.map((_, i) => rec.start / 1000 + i * rec.interval) : [])
  const spo2Data = $derived<uPlot.AlignedData>([xs, rec?.spo2 ?? []])
  const prData = $derived<uPlot.AlignedData>([xs, rec?.pr ?? []])
  const motionData = $derived<uPlot.AlignedData>([xs, rec?.motion ?? []])

  const sync = `rec-${Math.random().toString(36).slice(2)}`

  const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
  /** Hex colour token with alpha, for canvas fills. */
  function alpha(hex: string, a: number): string {
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex
  }
  /** Vertical gradient under a series line. */
  function areaFill(token: string, top = 0.22) {
    return (u: uPlot): CanvasGradient | string => {
      const c = css(token)
      const { top: y0, height: h } = u.bbox
      if (!Number.isFinite(y0) || !Number.isFinite(h) || h <= 0) return alpha(c, top / 2)
      const g = u.ctx.createLinearGradient(0, y0, 0, y0 + h)
      g.addColorStop(0, alpha(c, top))
      g.addColorStop(1, alpha(c, 0))
      return g
    }
  }
  const clock = (_u: uPlot, splits: number[]) =>
    splits.map((v) => (v == null ? '' : new Date(v * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))

  function axis(x = false): uPlot.Axis {
    return {
      stroke: css('--text-2'),
      font: FONT,
      grid: { stroke: css('--border'), width: 1 },
      ticks: { show: false },
      gap: 6,
      size: x ? 30 : 40,
      ...(x ? { space: 64, values: clock } : {}),
    }
  }

  function fixedRange(pref: string): [number, number] | null {
    const m = /^(\d+)-(\d+)$/.exec(pref)
    return m ? [Number(m[1]), Number(m[2])] : null
  }

  /** Mark reminder flags and >= 4 % drops on a chart. */
  function markers(kind: 'spo2' | 'pr'): (u: uPlot) => void {
    return (u) => {
      if (!rec || !stats) return
      const ctx = u.ctx
      ctx.save()
      if (kind === 'spo2') {
        ctx.fillStyle = alpha(css('--danger'), 0.16)
        for (const e of stats.events4) {
          const x0 = u.valToPos(xs[e.start], 'x', true)
          const x1 = u.valToPos(xs[Math.min(e.end, xs.length - 1)], 'x', true)
          ctx.fillRect(x0, u.bbox.top, Math.max(2, x1 - x0), u.bbox.height)
        }
      }
      const flags = kind === 'spo2' ? rec.spo2Alarm : rec.prAlarm
      if (flags) {
        ctx.fillStyle = kind === 'spo2' ? css('--spo2') : css('--pr')
        let last = -Infinity
        for (let i = 0; i < flags.length; i++) {
          if (!flags[i]) continue
          const x = u.valToPos(xs[i], 'x', true)
          if (x - last < 3) continue
          last = x
          ctx.fillRect(x - 1, u.bbox.top + u.bbox.height - 6, 2, 6)
        }
      }
      ctx.restore()
    }
  }

  const spo2Opts = $derived.by(() => {
    const fixed = fixedRange(app.prefs.spo2Range)
    return (width: number): uPlot.Options => ({
      width,
      height: 220,
      cursor: { sync: { key: sync }, drag: { x: true, y: false } },
      scales: {
        x: { time: true },
        y: { range: (_u, min) => fixed ?? [Math.min(80, Math.floor((min ?? 80) - 2)), 100] },
      },
      axes: [axis(true), axis()],
      series: [
        {},
        { label: 'SpO₂', stroke: css('--spo2'), fill: areaFill('--spo2', 0.14), width: 1.25, value: (_u, v) => (v == null ? '--' : `${v} %`) },
      ],
      hooks: { drawClear: [markers('spo2')] },
    })
  })
  const prOpts = $derived.by(() => {
    const fixed = fixedRange(app.prefs.prRange)
    return (width: number): uPlot.Options => ({
      width,
      height: 180,
      cursor: { sync: { key: sync }, drag: { x: true, y: false } },
      scales: {
        x: { time: true },
        y: { range: (_u, min, max) => fixed ?? [Math.min(40, (min ?? 40) - 5), Math.max(120, (max ?? 120) + 5)] },
      },
      axes: [axis(true), axis()],
      series: [
        {},
        { label: 'Pulse', stroke: css('--pr'), fill: areaFill('--pr', 0.1), width: 1, value: (_u, v) => (v == null ? '--' : `${v} bpm`) },
      ],
      hooks: { drawClear: [markers('pr')] },
    })
  })
  const motionOpts = (width: number): uPlot.Options => ({
    width,
    height: 100,
    cursor: { sync: { key: sync }, drag: { x: true, y: false } },
    scales: { x: { time: true }, y: { range: [0, 64] } },
    axes: [axis(true), axis()],
    series: [{}, { label: 'Motion', stroke: css('--motion'), fill: alpha(css('--motion'), 0.3), width: 1 }],
  })

  let plots: uPlot[] = []
  function onCreate(u: uPlot) {
    plots = plots.filter((p) => p.root.isConnected && p !== u)
    plots.push(u)
    u.hooks.setScale = [
      (self, key) => {
        if (key !== 'x') return
        const { min, max } = self.scales.x
        for (const p of plots) {
          if (p !== self && (p.scales.x.min !== min || p.scales.x.max !== max)) p.setScale('x', { min: min!, max: max! })
        }
      },
    ]
  }
  function resetZoom() {
    if (!xs.length) return
    for (const p of plots) p.setScale('x', { min: xs[0], max: xs[xs.length - 1] })
  }

  const dash = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? '--' : `${v}${unit}`)
  const hm = (ms: number) => fmtTime(ms).slice(11, 16)
  const deviceName = $derived(file.deviceModel ?? 'O2')
  const longDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  // Distribution bars shade from the SpO2 colour (95–100) towards warning/danger for the lower bands.
  const BAND_COLORS = [
    'var(--spo2)',
    'color-mix(in srgb, var(--spo2) 55%, var(--warn))',
    'var(--warn)',
    'color-mix(in srgb, var(--warn) 45%, var(--danger))',
    'var(--danger)',
  ]
  const bandColor = (i: number) => BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)]

  function exportCsv() {
    if (rec) download(`${exportBaseName(rec, deviceName)}.csv`, recordingToCsv(rec), 'text/csv')
  }
  function exportRaw() {
    download(file.fileName, file.bytes as BlobPart, 'application/octet-stream')
  }
  function print() {
    const old = document.title
    if (rec) document.title = exportBaseName(rec, deviceName)
    window.print()
    document.title = old
  }
  async function saveRemark() {
    if ((file.note ?? '') === remark) return
    await updateFile(file.id, { note: remark })
    await refreshStoredFiles()
  }
  async function savePatient(p: PatientInfo) {
    editing = false
    await updateFile(file.id, { patient: p })
    await refreshStoredFiles()
  }
</script>

{#if parsed.error}
  <section class="card">
    <h2>{file.fileName}</h2>
    <p class="err">Could not parse this file: {parsed.error}</p>
    <button onclick={exportRaw}>Download raw file</button>
  </section>
{:else if rec && stats}
  <article class="report">
    <section class="card overview">
      <div class="head">
        <div class="rtitle">
          <span class="overline">Oxygen Level Report</span>
          <h2>{longDate(stats.start)}</h2>
          <span class="meta">
            <span class="num">{hm(stats.start)}–{hm(stats.end)}</span> · {deviceName}{file.deviceSn ? ` · SN ${file.deviceSn}` : ''}
            <span class="print-only"> · {fmtTime(stats.start).slice(0, 10)}</span>
          </span>
        </div>
        <div class="toolbar no-print" role="toolbar" aria-label="Report actions">
          <button class="ghost" onclick={() => (editing = true)}><Icon name="user" size={16} />Patient info</button>
          <button class="ghost" onclick={exportCsv}><Icon name="table" size={16} />Export CSV</button>
          <button class="ghost" onclick={print}><Icon name="printer" size={16} />Print / PDF</button>
          <button class="ghost" onclick={exportRaw} title="Original device file"><Icon name="file" size={16} />Raw file</button>
        </div>
      </div>

      {#if rec.meta.warning}
        <p class="warn" role="alert"><Icon name="alert" size={16} /><span>{rec.meta.warning}</span></p>
      {/if}

      {#if hasPatient}
        <dl class="patient">
          {#if patient.name}<div><dt>Name</dt><dd>{patient.name}</dd></div>{/if}
          {#if patient.id}<div><dt>ID#</dt><dd>{patient.id}</dd></div>{/if}
          {#if patient.gender}<div><dt>Gender</dt><dd>{patient.gender}</dd></div>{/if}
          {#if patient.birthday}<div><dt>Date of birth</dt><dd>{patient.birthday}</dd></div>{/if}
          {#if patient.heightCm}<div><dt>Height</dt><dd>{fmtHeight(patient.heightCm, app.prefs.units)}</dd></div>{/if}
          {#if patient.weightKg}<div><dt>Weight</dt><dd>{fmtWeight(patient.weightKg, app.prefs.units)}</dd></div>{/if}
          {#if bmi(patient)}<div><dt>BMI</dt><dd>{bmi(patient)}</dd></div>{/if}
          {#if patient.physician}<div><dt>Physician</dt><dd>{patient.physician}</dd></div>{/if}
          {#if patient.note}<div class="wide"><dt>Note</dt><dd>{patient.note}</dd></div>{/if}
        </dl>
      {/if}

      <div class="tiles">
        <div class="tile score">
          <span class="k">O₂ score</span><span class="v">{stats.o2Score !== null ? stats.o2Score.toFixed(1) : '--'}</span>
        </div>
        <div class="tile">
          <span class="k">Duration</span><span class="v"><Dur value={fmtDur(stats.durationSec)} /></span>
          <span class="s">{hm(stats.start)} – {hm(stats.end)}</span>
        </div>
        <div class="tile">
          <span class="k">Drops over 4 %</span><span class="v">{dash(stats.drops4)}</span>
          <span class="s">ODI 4 %: {stats.odi4 !== null ? `${stats.odi4.toFixed(1)} /h` : 'Time<1h'}</span>
        </div>
        <div class="tile">
          <span class="k">Drops over 3 %</span><span class="v">{dash(stats.drops3)}</span>
          <span class="s">ODI 3 %: {stats.odi3 !== null ? `${stats.odi3.toFixed(1)} /h` : 'Time<1h'}</span>
        </div>
        <div class="tile">
          <span class="k">&lt; 90 % time</span><span class="v"><Dur value={fmtDur(stats.secBelow90)} /></span>
          <span class="s">{stats.pctBelow90.toFixed(1)} % of valid time</span>
        </div>
      </div>

      <div class="vitals">
        <div class="vital spo2">
          <span class="vh"><Icon name="droplet" size={15} />SpO₂</span>
          <dl>
            <div><dt>Highest</dt><dd>{stats.maxSpo2 ?? '--'}{#if stats.maxSpo2 != null}<small>%</small>{/if}</dd></div>
            <div><dt>Average</dt><dd>{stats.avgSpo2 ?? '--'}{#if stats.avgSpo2 != null}<small>%</small>{/if}</dd></div>
            <div><dt>Lowest</dt><dd>{stats.minSpo2 ?? '--'}{#if stats.minSpo2 != null}<small>%</small>{/if}</dd></div>
          </dl>
        </div>
        <div class="vital pr">
          <span class="vh"><Icon name="heart" size={15} />Pulse rate</span>
          <dl>
            <div><dt>Highest</dt><dd>{stats.maxPr ?? '--'}{#if stats.maxPr != null}<small>bpm</small>{/if}</dd></div>
            <div><dt>Average</dt><dd>{stats.avgPr ?? '--'}{#if stats.avgPr != null}<small>bpm</small>{/if}</dd></div>
            <div><dt>Lowest</dt><dd>{stats.minPr ?? '--'}{#if stats.minPr != null}<small>bpm</small>{/if}</dd></div>
          </dl>
        </div>
      </div>

      <label class="remark no-print">
        <Icon name="pencil" size={15} />
        <span class="overline">Remark</span>
        <input bind:value={remark} placeholder="Add a remark for this recording" onblur={saveRemark} onkeydown={(e) => e.key === 'Enter' && saveRemark()} />
      </label>
      {#if file.note}<p class="print-only">Remark: {file.note}</p>{/if}
    </section>

    <section class="card charts">
      <div class="head">
        <h3>Trends</h3>
        <button class="ghost small no-print" onclick={resetZoom}
          ><svg viewBox="0 0 24 24" width="14" height="14" class="ico" aria-hidden="true"
            ><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" /></svg
          >Reset zoom</button
        >
      </div>
      <div class="legend no-print">
        <span><span class="sw shade"></span>≥ 4 % drops (vendor algorithm)</span>
        <span><span class="sw tick"></span>Device reminder</span>
        <span class="muted">Drag across a chart to zoom</span>
      </div>
      {#if stats.dropsFromDevice}
        <p class="fine no-print">The drop counts above are the device’s own and can differ slightly from the shading.</p>
      {/if}
      <div class="chart-h"><span class="dot spo2"></span>SpO₂ <span class="u">%</span></div>
      <UPlot options={spo2Opts} data={spo2Data} height={220} {onCreate} />
      <div class="chart-h"><span class="dot pr"></span>Pulse rate <span class="u">bpm</span></div>
      <UPlot options={prOpts} data={prData} height={180} {onCreate} />
      <div class="chart-h"><span class="dot motion"></span>Motion</div>
      <UPlot options={motionOpts} data={motionData} height={100} {onCreate} />
    </section>

    <section class="card tables">
      <div>
        <h3 class="overline">Oxygen level</h3>
        <table>
          <thead><tr><th>SpO₂</th><th class="r">Duration</th><th class="r">% total</th></tr></thead>
          <tbody>
            {#each stats.spo2Summary as b (b.label)}
              <tr><td>{b.label}</td><td class="r">{fmtDur(b.sec)}</td><td class="r">{b.pct.toFixed(0)} %</td></tr>
            {/each}
          </tbody>
        </table>
        <h3 class="overline gap">Pulse rate</h3>
        <table>
          <thead><tr><th>Pulse</th><th class="r">Duration</th><th class="r">% total</th></tr></thead>
          <tbody>
            {#each stats.prBuckets as b (b.label)}
              <tr><td>{b.label}</td><td class="r">{fmtDur(b.sec)}</td><td class="r">{b.pct.toFixed(0)} %</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div>
        <h3 class="overline">SpO₂ distribution</h3>
        <div class="bars" role="img" aria-label="Share of time in each SpO₂ band">
          {#each stats.spo2Bands as b, i (b.label)}
            <div class="bar-row" style="--c: {bandColor(i)}">
              <span class="lbl">{b.label}</span>
              <span class="track"><span class="fill" style="width:{b.pct}%"></span></span>
              <span class="pct">{b.pct < 0.05 && b.pct > 0 ? '<0.1' : b.pct.toFixed(1)} %</span>
            </div>
          {/each}
        </div>
        <h3 class="overline gap">Details</h3>
        <table class="meta">
          <tbody>
            <tr><td>Start</td><td>{fmtTime(stats.start)}</td></tr>
            <tr><td>Sample interval</td><td>{rec.interval} s</td></tr>
            <tr><td>Valid SpO₂ time</td><td>{fmtDur(stats.validSpo2Sec)}</td></tr>
            {#if stats.dropsBelow90 !== null}<tr><td>Dips below 90 %</td><td>{stats.dropsBelow90}</td></tr>{/if}
            <tr>
              <td>Drop counts</td>
              <td>{stats.dropsFromDevice ? 'from device' : 'computed (vendor algorithm)'}</td>
            </tr>
            <tr><td>File</td><td class="mono">{file.fileName} ({rec.format})</td></tr>
          </tbody>
        </table>
        {#if Object.keys(rec.meta).length}
          <details class="filemeta no-print">
            <summary><Icon name="chevron-right" size={14} class="chev" />File metadata</summary>
            <table class="meta">
              <tbody>
                {#each Object.entries(rec.meta) as [k, v] (k)}
                  <tr><td>{k}</td><td class="mono">{v}</td></tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
      </div>
    </section>
  </article>
  {#if editing}
    <PatientDialog initial={{ ...app.prefs.defaultPatient, ...patient }} onSave={savePatient} onCancel={() => (editing = false)} />
  {/if}
{/if}

<style>
  .report {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }
  .overview > .head {
    align-items: flex-start;
    margin-bottom: 1.1rem;
  }
  .rtitle {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .rtitle h2 {
    font-size: var(--fs-xl);
    letter-spacing: -0.02em;
  }
  .meta {
    color: var(--text-2);
    font-size: 0.9333rem;
  }
  .toolbar {
    display: flex;
    gap: 0.15rem;
    padding: 3px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: var(--surface);
    flex-wrap: wrap;
  }
  .toolbar button {
    min-height: 2rem;
    padding: 0 0.65rem;
    font-size: var(--fs-sm);
    border-radius: 8px;
    color: var(--text-2);
  }
  .toolbar button:hover:not(:disabled) {
    color: var(--text);
  }
  .patient {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.6rem 1.2rem;
    margin: 0 0 1rem;
    padding: 0.8rem 1rem;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    font-size: 0.9333rem;
  }
  .patient div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .patient .wide {
    grid-column: 1 / -1;
  }
  .patient dt {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .patient dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.6rem;
  }
  .tile {
    background: var(--surface-2);
    border-radius: 12px;
    padding: 0.8rem 0.9rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .tile.score {
    background: var(--accent);
    color: var(--accent-text);
    justify-content: space-between;
  }
  .tile.score .k {
    color: color-mix(in srgb, var(--accent-text) 70%, transparent);
  }
  .tile.score .v {
    font-size: 2.6rem;
  }
  .k {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .v {
    font-size: 1.85rem;
    font-weight: 650;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    white-space: nowrap;
  }
  .s {
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .vitals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
    margin-top: 0.6rem;
  }
  .vital {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.75rem 0.9rem;
  }
  .vh {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .spo2 .vh {
    color: var(--spo2);
  }
  .pr .vh {
    color: var(--pr);
  }
  .vital dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: 0.4rem 0 0;
  }
  .vital dl div + div {
    border-left: 1px solid var(--border);
    padding-left: 0.8rem;
  }
  .vital dt {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .vital dd {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .vital small {
    font-size: 0.55em;
    font-weight: 600;
    color: var(--text-2);
    margin-left: 0.15em;
    letter-spacing: 0;
  }
  .remark {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 1rem;
    padding: 0 0 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-2);
  }
  .remark:focus-within {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent);
  }
  .remark input {
    flex: 1;
    border: none;
    background: none;
    min-width: 0;
  }
  .remark input:focus-visible {
    outline: none;
  }
  .small {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
  }
  .charts .head {
    margin-bottom: 0.4rem;
  }
  .charts .ico {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1.1rem;
    font-size: var(--fs-xs);
    color: var(--text-2);
    margin-bottom: 0.3rem;
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .sw {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .sw.shade {
    background: color-mix(in srgb, var(--danger) 22%, transparent);
  }
  .sw.tick {
    width: 3px;
    border-radius: 1px;
    background: var(--spo2);
  }
  .fine {
    margin: 0 0 0.3rem;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .chart-h {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 1.7rem;
    margin-top: 0.9rem;
    font-size: var(--fs-sm);
    font-weight: 650;
  }
  .chart-h .u {
    font-weight: 500;
    color: var(--text-2);
  }
  .chart-h .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.spo2 {
    background: var(--spo2);
  }
  .dot.pr {
    background: var(--pr);
  }
  .dot.motion {
    background: var(--motion);
  }
  /* The live cursor readout sits on the chart's title row, right-aligned, at every width. */
  .charts :global(.uplot) {
    position: relative;
  }
  .charts :global(.u-legend) {
    position: absolute;
    top: -1.7rem;
    left: auto;
    right: 0;
    width: auto;
    max-width: 70%;
    height: 1.7rem;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    white-space: nowrap;
  }
  @media (max-width: 560px) {
    .charts :global(.u-legend) {
      font-size: 0.7333rem;
    }
  }
  @media print {
    .charts :global(.u-legend) {
      display: none;
    }
  }
  .tables {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.2rem 2rem;
  }
  .tables h3 {
    margin-bottom: 0.4rem;
  }
  .gap {
    margin-top: 1.4rem;
  }
  td {
    font-size: 0.9333rem;
    font-variant-numeric: tabular-nums;
  }
  th.r,
  td.r {
    text-align: right;
  }
  .meta td:first-child {
    color: var(--text-2);
  }
  .meta td {
    padding: 0.42rem 0.5rem;
  }
  .filemeta {
    margin-top: 0.8rem;
  }
  .filemeta summary {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--fs-sm);
    color: var(--text-2);
    list-style: none;
  }
  .filemeta summary::-webkit-details-marker {
    display: none;
  }
  .filemeta :global(.chev) {
    transition: transform 0.15s;
  }
  .filemeta[open] :global(.chev) {
    transform: rotate(90deg);
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-top: 0.6rem;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 3.6rem 1fr 3.6rem;
    align-items: center;
    gap: 0.6rem;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .lbl {
    color: var(--text-2);
  }
  .track {
    height: 12px;
    background: var(--surface-2);
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    min-width: 0;
    background: var(--c, var(--spo2));
    border-radius: 4px;
  }
  .pct {
    text-align: right;
    font-weight: 550;
  }
  .err {
    color: var(--danger);
  }
  .warn {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    color: var(--warn);
    margin: 0 0 1rem;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warn) 10%, var(--surface));
    font-size: var(--fs-sm);
  }
  .print-only {
    display: none;
  }
  @media (max-width: 1000px) {
    .tiles {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 640px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tile.score {
      grid-column: 1 / -1;
      flex-direction: row;
      align-items: center;
    }
    .vitals {
      grid-template-columns: 1fr;
    }
    /* Phone: an action row of four equal icon-over-label buttons. */
    .toolbar {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .toolbar button {
      flex-direction: column;
      gap: 0.2rem;
      min-height: 3.2rem;
      padding: 0.3rem 0.2rem;
      font-size: 0.7333rem;
      white-space: normal;
      line-height: 1.15;
      text-align: center;
    }
    .rtitle h2 {
      font-size: var(--fs-lg);
    }
  }
  @media print {
    .no-print {
      display: none !important;
    }
    .print-only {
      display: block;
    }
    span.print-only {
      display: inline;
    }
    .tiles {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .tile.score {
      background: var(--surface-2);
      color: var(--text);
    }
    .tile.score .k {
      color: var(--text-2);
    }
  }
</style>
