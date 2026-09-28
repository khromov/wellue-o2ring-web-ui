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

  let { file }: { file: StoredFile } = $props()

  const parsed = $derived.by(() => {
    try {
      return { rec: parseAny(file.bytes, file.format, file.fileName), error: '' }
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

  function axis(label?: string) {
    return {
      stroke: css('--text-2'),
      grid: { stroke: css('--border'), width: 1 },
      ticks: { stroke: css('--border'), width: 1 },
      label,
      size: 52,
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
        ctx.fillStyle = 'rgba(232, 69, 60, 0.12)'
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
      axes: [axis(), axis('SpO₂ %')],
      series: [{}, { label: 'SpO₂', stroke: css('--spo2'), width: 1.2, value: (_u, v) => (v == null ? '--' : `${v} %`) }],
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
      axes: [axis(), axis('Pulse bpm')],
      series: [{}, { label: 'Pulse', stroke: css('--pr'), width: 1, value: (_u, v) => (v == null ? '--' : `${v} bpm`) }],
      hooks: { drawClear: [markers('pr')] },
    })
  })
  const motionOpts = (width: number): uPlot.Options => ({
    width,
    height: 100,
    cursor: { sync: { key: sync }, drag: { x: true, y: false } },
    scales: { x: { time: true }, y: { range: [0, 64] } },
    axes: [axis(), axis('Motion')],
    series: [{}, { label: 'Motion', stroke: css('--motion'), fill: css('--motion') + '40', width: 1 }],
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
    <section class="card">
      <div class="head">
        <div>
          <h2>Oxygen Level Report</h2>
          <span class="muted">
            {fmtTime(stats.start).slice(0, 10)} · {hm(stats.start)}–{hm(stats.end)} · {deviceName}{file.deviceSn
              ? ` · SN ${file.deviceSn}`
              : ''}
          </span>
        </div>
        <div class="row no-print">
          <button onclick={() => (editing = true)}>Patient info</button>
          <button onclick={exportCsv}>Export CSV</button>
          <button onclick={print}>Print / PDF</button>
          <button onclick={exportRaw} title="Original device file">Raw file</button>
        </div>
      </div>

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
        <div class="tile">
          <span class="k">O₂ score</span><span class="v">{stats.o2Score !== null ? stats.o2Score.toFixed(1) : '--'}</span>
        </div>
        <div class="tile">
          <span class="k">Duration</span><span class="v sm">{fmtDur(stats.durationSec)}</span>
          <span class="muted s">{hm(stats.start)} – {hm(stats.end)}</span>
        </div>
        <div class="tile">
          <span class="k">Drops over 4 %</span><span class="v">{dash(stats.drops4)}</span>
          <span class="muted s">ODI 4 %: {stats.odi4 !== null ? `${stats.odi4.toFixed(1)} /h` : 'Time<1h'}</span>
        </div>
        <div class="tile">
          <span class="k">Drops over 3 %</span><span class="v">{dash(stats.drops3)}</span>
          <span class="muted s">ODI 3 %: {stats.odi3 !== null ? `${stats.odi3.toFixed(1)} /h` : 'Time<1h'}</span>
        </div>
        <div class="tile">
          <span class="k">&lt; 90 % time</span><span class="v sm">{fmtDur(stats.secBelow90)}</span>
          <span class="muted s">{stats.pctBelow90.toFixed(1)} % of valid time</span>
        </div>
      </div>

      <div class="summary">
        <table>
          <thead><tr><th></th><th>Highest</th><th>Average</th><th>Lowest</th></tr></thead>
          <tbody>
            <tr>
              <td class="spo2">SpO₂</td>
              <td>{dash(stats.maxSpo2, ' %')}</td>
              <td>{dash(stats.avgSpo2, ' %')}</td>
              <td>{dash(stats.minSpo2, ' %')}</td>
            </tr>
            <tr>
              <td class="pr">Pulse rate</td>
              <td>{dash(stats.maxPr, ' bpm')}</td>
              <td>{dash(stats.avgPr, ' bpm')}</td>
              <td>{dash(stats.minPr, ' bpm')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <label class="remark no-print">
        <span class="muted">Remark</span>
        <input bind:value={remark} placeholder="Add a remark for this recording" onblur={saveRemark} onkeydown={(e) => e.key === 'Enter' && saveRemark()} />
      </label>
      {#if file.note}<p class="print-only">Remark: {file.note}</p>{/if}
    </section>

    <section class="card charts">
      <div class="head">
        <h3>Trends</h3>
        <span class="muted s no-print">Drag to zoom · shaded = ≥ 4 % drop · ticks = reminder</span>
        <button class="small no-print" onclick={resetZoom}>Reset zoom</button>
      </div>
      <UPlot options={spo2Opts} data={spo2Data} height={220} {onCreate} />
      <UPlot options={prOpts} data={prData} height={180} {onCreate} />
      <UPlot options={motionOpts} data={motionData} height={100} {onCreate} />
    </section>

    <section class="card tables">
      <div>
        <h3>Oxygen level</h3>
        <table>
          <thead><tr><th>SpO₂</th><th>Duration</th><th>% total</th></tr></thead>
          <tbody>
            {#each stats.spo2Summary as b}
              <tr><td>{b.label}</td><td>{fmtDur(b.sec)}</td><td>{b.pct.toFixed(0)} %</td></tr>
            {/each}
          </tbody>
        </table>
        <h3 class="gap">Pulse rate</h3>
        <table>
          <thead><tr><th>Pulse</th><th>Duration</th><th>% total</th></tr></thead>
          <tbody>
            {#each stats.prBuckets as b}
              <tr><td>{b.label}</td><td>{fmtDur(b.sec)}</td><td>{b.pct.toFixed(0)} %</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div>
        <h3>SpO₂ distribution</h3>
        <div class="bars" role="img" aria-label="Share of time in each SpO₂ band">
          {#each stats.spo2Bands as b}
            <div class="bar-row">
              <span class="lbl">{b.label}</span>
              <span class="track"><span class="fill" style="width:{b.pct}%"></span></span>
              <span class="pct">{b.pct < 0.05 && b.pct > 0 ? '<0.1' : b.pct.toFixed(1)} %</span>
            </div>
          {/each}
        </div>
        <h3 class="gap">Details</h3>
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
            {#each Object.entries(rec.meta) as [k, v]}
              <tr class="no-print"><td>{k}</td><td class="mono">{v}</td></tr>
            {/each}
          </tbody>
        </table>
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
  .patient {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.6rem;
    margin: 0 0 1rem;
    padding: 0.7rem 0.9rem;
    background: var(--surface-2);
    border-radius: 8px;
    font-size: 0.9rem;
  }
  .patient div {
    display: flex;
    gap: 0.4rem;
  }
  .patient .wide {
    flex-basis: 100%;
  }
  .patient dt {
    color: var(--text-2);
  }
  .patient dd {
    margin: 0;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.6rem;
  }
  .tile {
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    display: flex;
    flex-direction: column;
  }
  .k {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .v {
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .v.sm {
    font-size: 1.25rem;
    line-height: 1.6;
  }
  .s {
    font-size: 0.78rem;
  }
  .summary {
    margin-top: 1rem;
  }
  .summary td,
  .summary th {
    font-variant-numeric: tabular-nums;
  }
  td.spo2 {
    color: var(--spo2);
    font-weight: 600;
  }
  td.pr {
    color: var(--pr);
    font-weight: 600;
  }
  .remark {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .remark input {
    flex: 1;
  }
  .small {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
  }
  .tables {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
  }
  .gap {
    margin-top: 1.2rem;
  }
  td {
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }
  .meta td:first-child {
    color: var(--text-2);
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.5rem;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 4rem 1fr 4rem;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 10px;
    background: var(--surface-2);
    border-radius: 5px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--spo2);
    border-radius: 5px;
  }
  .pct {
    text-align: right;
  }
  .err {
    color: var(--danger);
  }
  .print-only {
    display: none;
  }
  @media print {
    .no-print {
      display: none !important;
    }
    .print-only {
      display: block;
    }
  }
</style>
