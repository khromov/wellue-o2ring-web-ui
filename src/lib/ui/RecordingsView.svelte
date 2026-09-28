<script lang="ts">
  import { app, deviceFileId, importFiles, refreshStoredFiles } from '../app.svelte'
  import { deleteFile, markRemoved, type StoredFile } from '../storage'
  import { fmtTime } from '../files/csv'
  import RecordingDetail from './RecordingDetail.svelte'

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
>
  <aside class="card list no-print">
    <div class="head">
      <h2>Recordings</h2>
      <div class="row">
        {#if app.files.length}
          <button class="small" onclick={() => ((selecting = !selecting), (checked = {}))}>{selecting ? 'Done' : 'Select'}</button>
        {/if}
        <button class="small" onclick={() => fileInput.click()} title="Import record files (from the device, O2 Insight or ViHealth)">Import</button>
      </div>
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
    </div>
    {#if selecting}
      <div class="selbar">
        <span class="muted">{nChecked} selected</span>
        <button class="small danger" disabled={!nChecked} onclick={removeChecked}>Remove</button>
      </div>
    {/if}
    {#if app.files.length === 0}
      <p class="muted empty">
        No recordings yet. Connect a device and download its recordings, or drop record files here.
      </p>
    {:else}
      {#each groups as g (g.label)}
        <h3 class="month">{g.label}</h3>
        <ul>
          {#each g.files as f (f.id)}
            <li>
              {#if selecting}
                <input type="checkbox" bind:checked={checked[f.id]} aria-label="Select {label(f)}" />
              {/if}
              <button class="item" class:sel={selected?.id === f.id} onclick={() => (app.selectedId = f.id)}>
                <span class="when">{label(f)}</span>
                <span class="muted sub">{f.deviceModel ?? 'Imported'}{f.note ? ` · ${f.note}` : ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    {/if}
  </aside>
  <div class="detail">
    {#if selected}
      {#key selected.id}
        <RecordingDetail file={selected} />
      {/key}
    {/if}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 270px minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .layout.dragging {
    outline: 2px dashed var(--accent);
    outline-offset: 6px;
    border-radius: var(--radius);
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  @media print {
    .layout {
      display: block;
    }
  }
  .list {
    padding: 0.8rem;
    position: sticky;
    top: 4.2rem;
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
    margin-bottom: 0.4rem;
  }
  .selbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.2rem 0.5rem;
  }
  .month {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-2);
    margin: 0.8rem 0.4rem 0.3rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .item {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    text-align: left;
  }
  .item.sel {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .when {
    font-variant-numeric: tabular-nums;
  }
  .sub {
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .small {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
  }
  .empty {
    font-size: 0.9rem;
  }
</style>
