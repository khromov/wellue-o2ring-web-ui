<script lang="ts">
  import { app, refreshStoredFiles, resetDeviceFileMarks, savePrefs } from '../app.svelte'
  import { clearRemoved, listFiles, deleteFile, type PatientInfo } from '../storage'
  import { fmtHeight, fmtWeight } from './format'
  import PatientDialog from './PatientDialog.svelte'

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

  const d = $derived(app.prefs.defaultPatient)
  const hasDefault = $derived(Object.values(d).some((v) => v !== undefined && v !== ''))
</script>

<section class="card">
  <h2>Options</h2>
  <div class="form">
    <label class="field">
      <span>SpO₂ chart range</span>
      <select bind:value={app.prefs.spo2Range} onchange={savePrefs}>
        <option value="auto">Automatic</option>
        <option value="0-100">0–100 %</option>
        <option value="35-100">35–100 %</option>
        <option value="50-100">50–100 %</option>
        <option value="70-100">70–100 %</option>
      </select>
    </label>
    <label class="field">
      <span>Pulse chart range</span>
      <select bind:value={app.prefs.prRange} onchange={savePrefs}>
        <option value="auto">Automatic</option>
        <option value="25-150">25–150 bpm</option>
        <option value="25-250">25–250 bpm</option>
      </select>
    </label>
    <label class="field">
      <span>Units</span>
      <select bind:value={app.prefs.units} onchange={savePrefs}>
        <option value="metric">Metric (cm, kg)</option>
        <option value="imperial">Imperial (ft/in, lbs)</option>
      </select>
    </label>
    <label class="field">
      <span>
        Set the device clock on connect
        <span class="muted help">The official apps do this every time. Recording start times come from the device clock.</span>
      </span>
      <input type="checkbox" bind:checked={app.prefs.syncTime} onchange={savePrefs} />
    </label>
    <label class="field">
      <span>Show protocol log <span class="muted help">Raw bytes sent and received, for troubleshooting.</span></span>
      <input type="checkbox" bind:checked={app.prefs.debug} onchange={savePrefs} />
    </label>
    <div class="field">
      <span>
        Default patient information
        <span class="muted help">
          {#if hasDefault}
            {[d.name, d.id, d.heightCm && fmtHeight(d.heightCm, app.prefs.units), d.weightKg && fmtWeight(d.weightKg, app.prefs.units)]
              .filter(Boolean)
              .join(' · ')}
          {:else}
            Pre-filled into new reports.
          {/if}
        </span>
      </span>
      <button onclick={() => (editing = true)}>Edit…</button>
    </div>
    <div class="field">
      <span>Stored data <span class="muted help">{app.files.length} recordings in this browser (IndexedDB).</span></span>
      <button class="danger" disabled={!app.files.length} onclick={clearAll}>Delete all…</button>
    </div>
  </div>
</section>

{#if editing}
  <PatientDialog title="Default patient information" initial={app.prefs.defaultPatient} onSave={saveDefault} onCancel={() => (editing = false)} />
{/if}

<style>
  h2 {
    margin-bottom: 0.8rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    max-width: 640px;
  }
  .field {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
  }
  .field:last-child {
    border-bottom: none;
  }
  .field > span {
    display: flex;
    flex-direction: column;
  }
  .help {
    font-size: 0.8rem;
  }
</style>
