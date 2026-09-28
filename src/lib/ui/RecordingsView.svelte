<script lang="ts">
  import { app, deviceFileId, importFiles, refreshStoredFiles } from '../app.svelte'
  import { deleteFile, markRemoved, type StoredFile } from '../storage'
  import { fmtTime } from '../files/csv'
  import RecordingDetail from './RecordingDetail.svelte'
  import Icon from './Icon.svelte'

  let fileInput: HTMLInputElement
  let dragging = $state(false)
  let selecting = $state(false)
  let checked = $state<Record<string, boolean>>({})

  const selected = $derived(app.files.find((f) => f.id === app.selectedId) ?? app.files[0] ?? null)
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const groups = $derived.by(() => {
    const out: { label: string; files: StoredFile[] }[] = []
    for (const f of app.files) {
      const d = new Date(f.startTime ?? f.addedAt)
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
      const last = out[out.length - 1]
      if (last && last.label === label) last.files.push(f)
      else out.push({ label, files: [f] })
    }
    return out
  })
  const nChecked = $derived(Object.values(checked).filter(Boolean).length)

  function label(f: StoredFile): string {
    if (!f.startTime) return f.fileName
    const d = new Date(f.startTime)
    return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(f.startTime).slice(11, 16)}`
  }

  // Calendar-style badge for the list (presentation only).
  function badge(f: StoredFile): { dow: string; day: string; time: string } | null {
    if (!f.startTime) return null
    const d = new Date(f.startTime)
    return {
      dow: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: String(d.getDate()),
      time: fmtTime(f.startTime).slice(11, 16),
    }
  }

  async function removeChecked() {
    const ids = Object.keys(checked).filter((k) => checked[k])
    if (!ids.length) return
    if (!confirm(`Remove ${ids.length} recording${ids.length > 1 ? 's' : ''} from this browser? The device is not affected.`)) return
    for (const id of ids) await deleteFile(id)
    markRemoved(ids.filter((id) => !id.startsWith('import/')))
    const gone = new Set(ids)
    for (const row of app.deviceFiles) {
      if (gone.has(deviceFileId(row.name) ?? '')) {
        row.stored = false
        row.removed = true
      }
    }
    if (app.selectedId && ids.includes(app.selectedId)) app.selectedId = null
    checked = {}
    selecting = false
    await refreshStoredFiles()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files)
  }
</script>

<div
  class="layout"
  role="region"
  aria-label="Recordings"
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  class:dragging
  class:none={app.files.length === 0}
>
  <input
    bind:this={fileInput}
    type="file"
    multiple
    hidden
    onchange={(e) => {
      const f = e.currentTarget.files
      if (f?.length) void importFiles(f)
      e.currentTarget.value = ''
    }}
  />
  {#if app.files.length === 0}
    <section class="card empty-state">
      <span class="empty-icon"><Icon name="moon" size={26} /></span>
      <h2>No recordings yet</h2>
      <p class="muted">Connect a device and download its recordings, or drop record files here.</p>
      <button class="primary" onclick={() => fileInput.click()}><Icon name="upload" size={16} />Import files…</button>
      <p class="hint">Record files from the device, O2 Insight or ViHealth.</p>
    </section>
  {:else}
    <aside class="card list no-print">
      <div class="head">
        <h2>Recordings</h2>
        <div class="row">
          <button class="ghost small" class:on={selecting} onclick={() => ((selecting = !selecting), (checked = {}))}
            >{selecting ? 'Done' : 'Select'}</button
          >
          <button class="small" onclick={() => fileInput.click()} title="Import record files (from the device, O2 Insight or ViHealth)"
            ><Icon name="upload" size={14} />Import</button
          >
        </div>
      </div>
      {#if selecting}
        <div class="selbar">
          <span class="muted">{nChecked} selected</span>
          <button class="small danger" disabled={!nChecked} onclick={removeChecked}><Icon name="trash" size={14} />Remove</button>
        </div>
      {/if}
      {#each groups as g (g.label)}
        <h3 class="month">{g.label}</h3>
        <ul>
          {#each g.files as f (f.id)}
            {@const b = badge(f)}
            <li>
              {#if selecting}
                <input type="checkbox" bind:checked={checked[f.id]} aria-label="Select {label(f)}" />
              {/if}
              <button class="item" class:sel={selected?.id === f.id} onclick={() => (app.selectedId = f.id)} aria-label={label(f)}>
                <span class="cal" aria-hidden="true">
                  {#if b}<span class="dow">{b.dow}</span><span class="day">{b.day}</span>{:else}<Icon name="file" size={16} />{/if}
                </span>
                <span class="txt">
                  <span class="when">{b ? b.time : f.fileName}</span>
                  <span class="sub">{f.deviceModel ?? 'Imported'}{f.note ? ` · ${f.note}` : ''}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </aside>
    <div class="detail">
      {#if selected}
        {#key selected.id}
          <RecordingDetail file={selected} />
        {/key}
      {/if}
    </div>
  {/if}
</div>

<style>
  .layout {
    position: relative;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .layout.none {
    grid-template-columns: minmax(0, 1fr);
  }
  .layout.dragging::after {
    content: 'Drop record files to import';
    position: absolute;
    inset: -6px;
    z-index: 5;
    display: grid;
    place-items: center;
    border: 2px dashed var(--focus, var(--accent));
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--focus, var(--accent)) 8%, color-mix(in srgb, var(--bg) 80%, transparent));
    color: var(--focus, var(--accent));
    font-weight: 650;
    pointer-events: none;
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media print {
    .layout {
      display: block;
    }
  }
  .list {
    padding: 0.9rem 0.6rem 0.6rem;
    position: sticky;
    top: 4.6rem;
    max-height: calc(100vh - 6rem);
    overflow: auto;
  }
  @media (max-width: 800px) {
    .list {
      position: static;
      max-height: 40vh;
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.3rem 0 0.5rem;
    margin-bottom: 0.2rem;
  }
  .head h2 {
    font-size: var(--fs-md, 1rem);
  }
  .head .row {
    gap: 0.25rem;
    flex-wrap: nowrap;
  }
  .selbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0.4rem 0.3rem 0.2rem;
    padding: 0.35rem 0.35rem 0.35rem 0.6rem;
    border-radius: var(--radius-sm, 8px);
    background: var(--surface-2);
    font-size: var(--fs-sm, 0.85rem);
  }
  .month {
    font-size: var(--fs-xs, 0.78rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin: 0.9rem 0.5rem 0.35rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding-left: 0.2rem;
  }
  .item {
    flex: 1;
    min-width: 0;
    min-height: 0;
    border: 1px solid transparent;
    background: none;
    justify-content: flex-start;
    gap: 0.7rem;
    padding: 0.4rem 0.5rem;
    border-radius: 10px;
    text-align: left;
    font-weight: 400;
  }
  .item:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: transparent;
  }
  .item.sel,
  .item.sel:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border);
  }
  .cal {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 9px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
    line-height: 1;
  }
  .item.sel .cal {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .dow {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
  }
  .day {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    margin-top: 1px;
    font-variant-numeric: tabular-nums;
  }
  .item.sel .day {
    color: inherit;
  }
  .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .when {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: var(--fs-xs, 0.78rem);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .small {
    font-size: var(--fs-xs, 0.8rem);
    padding: 0 0.55rem;
  }
  .ghost.on {
    background: var(--surface-2);
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.6rem;
    padding: 3.2rem 1.5rem;
  }
  .empty-state h2 {
    margin-top: 0.4rem;
  }
  .empty-state p {
    margin: 0;
    max-width: 42ch;
  }
  .empty-state button {
    margin-top: 0.6rem;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
  }
  .hint {
    font-size: var(--fs-xs, 0.8rem);
    color: var(--text-2);
  }
</style>
