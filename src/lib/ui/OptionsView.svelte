<script lang="ts">
  import { app, exportAllData, log, refreshStoredFiles, resetDeviceFileMarks, restoreBackup, savePrefs } from '../app.svelte'
  import { clearRemoved, listFiles, deleteFile, type PatientInfo } from '../storage'
  import { fmtHeight, fmtWeight } from './format'
  import PatientDialog from './PatientDialog.svelte'
  import Icon from './Icon.svelte'

  let editing = $state(false)

  function saveDefault(p: PatientInfo) {
    app.prefs.defaultPatient = p
    savePrefs()
    editing = false
  }

  async function clearAll() {
    if (!confirm('Delete ALL recordings stored in this browser? The device is not affected.')) return
    for (const f of await listFiles()) await deleteFile(f.id)
    clearRemoved()
    resetDeviceFileMarks()
    app.selectedId = null
    await refreshStoredFiles()
  }

  let backupInput: HTMLInputElement
  let working = $state<'' | 'export' | 'restore'>('')
  let backupMsg = $state('')

  async function doExport() {
    working = 'export'
    backupMsg = ''
    try {
      await exportAllData()
    } catch (e) {
      app.error = `Export failed: ${e instanceof Error ? e.message : String(e)}`
      log('error', app.error)
    } finally {
      working = ''
    }
  }

  async function doRestore(file: File) {
    if (!confirm(`Restore from ${file.name}? Recordings in the backup are added (nothing here is deleted) and the backup's settings replace the current ones.`)) return
    working = 'restore'
    backupMsg = ''
    try {
      const r = await restoreBackup(file)
      backupMsg = `Restored: ${r.added} added, ${r.updated} updated, ${r.unchanged} already here${r.settings ? '; settings restored' : ''}.`
    } catch (e) {
      app.error = `Restore failed: ${e instanceof Error ? e.message : String(e)}`
      log('error', app.error)
    } finally {
      working = ''
    }
  }

  const d = $derived(app.prefs.defaultPatient)
  const hasDefault = $derived(Object.values(d).some((v) => v !== undefined && v !== ''))
</script>

<div class="page">
  <header class="ph">
    <h2>Options</h2>
    <p class="muted">Saved in this browser.</p>
  </header>

  <section class="group">
    <h3 class="overline">Charts</h3>
    <div class="card list">
      <label class="field">
        <span class="lbl">SpO₂ chart range</span>
        <select bind:value={app.prefs.spo2Range} onchange={savePrefs}>
          <option value="auto">Automatic</option>
          <option value="0-100">0–100 %</option>
          <option value="35-100">35–100 %</option>
          <option value="50-100">50–100 %</option>
          <option value="70-100">70–100 %</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Pulse chart range</span>
        <select bind:value={app.prefs.prRange} onchange={savePrefs}>
          <option value="auto">Automatic</option>
          <option value="25-150">25–150 bpm</option>
          <option value="25-250">25–250 bpm</option>
        </select>
      </label>
    </div>
  </section>

  <section class="group">
    <h3 class="overline">Reports</h3>
    <div class="card list">
      <label class="field">
        <span class="lbl">Units</span>
        <select bind:value={app.prefs.units} onchange={savePrefs}>
          <option value="metric">Metric (cm, kg)</option>
          <option value="imperial">Imperial (ft/in, lbs)</option>
        </select>
      </label>
      <div class="field">
        <span class="lbl">
          Default patient information
          <span class="help">
            {#if hasDefault}
              {[d.name, d.id, d.heightCm && fmtHeight(d.heightCm, app.prefs.units), d.weightKg && fmtWeight(d.weightKg, app.prefs.units)]
                .filter(Boolean)
                .join(' · ')}
            {:else}
              Pre-filled into new reports.
            {/if}
          </span>
        </span>
        <button onclick={() => (editing = true)}><Icon name="user" size={15} />Edit…</button>
      </div>
    </div>
  </section>

  <section class="group">
    <h3 class="overline">Device</h3>
    <div class="card list">
      <label class="field">
        <span class="lbl">
          Set the device clock on connect
          <span class="help">The official apps do this every time. Recording start times come from the device clock.</span>
        </span>
        <span class="switch"><input type="checkbox" role="switch" bind:checked={app.prefs.syncTime} onchange={savePrefs} /><span class="track"></span></span>
      </label>
    </div>
  </section>

  <section class="group">
    <h3 class="overline">Data &amp; troubleshooting</h3>
    <div class="card list">
      <label class="field">
        <span class="lbl">Show protocol log <span class="help">Raw bytes sent and received, for troubleshooting.</span></span>
        <span class="switch"><input type="checkbox" role="switch" bind:checked={app.prefs.debug} onchange={savePrefs} /><span class="track"></span></span>
      </label>
      <div class="field">
        <span class="lbl"
          >Export all data <span class="help"
            >A ZIP with every recording (raw device files and CSVs), remarks, patient info and settings.</span
          ></span
        >
        <button disabled={!!working} onclick={doExport}
          ><Icon name="download" size={15} />{working === 'export' ? 'Exporting…' : 'Export…'}</button
        >
      </div>
      <div class="field">
        <span class="lbl"
          >Restore from backup <span class="help"
            >{backupMsg || 'Adds the recordings from a backup ZIP and restores its settings. Nothing here is deleted.'}</span
          ></span
        >
        <button disabled={!!working} onclick={() => backupInput.click()}
          ><Icon name="upload" size={15} />{working === 'restore' ? 'Restoring…' : 'Restore…'}</button
        >
        <input
          bind:this={backupInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onchange={(e) => {
            const f = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (f) void doRestore(f)
          }}
        />
      </div>
      <div class="field">
        <span class="lbl">Stored data <span class="help">{app.files.length} recordings in this browser (IndexedDB).</span></span>
        <button class="danger" disabled={!app.files.length} onclick={clearAll}><Icon name="trash" size={15} />Delete all…</button>
      </div>
    </div>
  </section>
</div>

{#if editing}
  <PatientDialog title="Default patient information" initial={app.prefs.defaultPatient} onSave={saveDefault} onCancel={() => (editing = false)} />
{/if}

<style>
  .page {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }
  .ph h2 {
    font-size: var(--fs-xl);
    letter-spacing: -0.02em;
  }
  .ph p {
    margin: 0.2rem 0 0;
  }
  .group h3 {
    margin: 0 0 0.5rem 0.2rem;
  }
  .list {
    padding: 0 1.1rem;
  }
  .field {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    min-height: 3.4rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border);
  }
  label.field {
    cursor: pointer;
  }
  .field:last-child {
    border-bottom: none;
  }
  .lbl {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    font-weight: 500;
    min-width: 0;
  }
  .help {
    font-size: var(--fs-xs);
    font-weight: 400;
    color: var(--text-2);
  }
  .field select {
    flex: none;
    min-width: 11rem;
  }
  .switch {
    position: relative;
    flex: none;
    width: 42px;
    height: 24px;
  }
  .switch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .track {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    pointer-events: none;
    transition: background-color 0.15s;
  }
  .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
    transition: transform 0.15s;
  }
  .switch input:checked + .track {
    background: var(--control-on, var(--accent));
    border-color: transparent;
  }
  .switch input:checked + .track::after {
    transform: translateX(18px);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
  }
  @media (max-width: 520px) {
    .field select {
      min-width: 0;
      max-width: 48%;
    }
  }
</style>
