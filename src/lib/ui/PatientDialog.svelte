<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../app.svelte'
  import type { PatientInfo } from '../storage'
  import { feetInches } from './format'

  let {
    initial,
    title = 'Patient information',
    onSave,
    onCancel,
  }: { initial: PatientInfo; title?: string; onSave: (p: PatientInfo) => void; onCancel: () => void } = $props()

  let dlg: HTMLDialogElement
  // svelte-ignore state_referenced_locally
  let p = $state<PatientInfo>({ ...initial })
  const imperial = $derived(app.prefs.units === 'imperial')

  // Imperial inputs, converted to metric on save (only if the user changed them,
  // so saving doesn't drift the stored metric values through rounding).
  // svelte-ignore state_referenced_locally
  const fi0 = initial.heightCm ? feetInches(initial.heightCm) : undefined
  // svelte-ignore state_referenced_locally
  const lbs0 = initial.weightKg ? Math.round(initial.weightKg * 2.20462) : undefined
  let ft = $state(fi0?.ft)
  let inch = $state(fi0?.inch)
  let lbs = $state(lbs0)

  onMount(() => dlg.showModal())

  // Autocomplete from patients used in earlier reports (O2 Insight tb_patientsearch).
  const known = $derived.by(() => {
    const m = new Map<string, PatientInfo>()
    for (const f of app.files) if (f.patient?.name) m.set(f.patient.name, f.patient)
    return m
  })

  function pickKnown() {
    const k = p.name ? known.get(p.name) : undefined
    if (k && !p.id && !p.birthday) p = { ...k, note: p.note }
  }

  function save(e: SubmitEvent) {
    e.preventDefault()
    const out: PatientInfo = { ...p }
    if (imperial) {
      if (ft !== fi0?.ft || inch !== fi0?.inch) out.heightCm = ft || inch ? ((ft ?? 0) * 12 + (inch ?? 0)) * 2.54 : undefined
      if (lbs !== lbs0) out.weightKg = lbs ? lbs / 2.20462 : undefined
    }
    for (const k of Object.keys(out) as (keyof PatientInfo)[]) if (out[k] === '' || out[k] === null) delete out[k]
    onSave(out)
  }
</script>

<dialog bind:this={dlg} onclose={onCancel}>
  <form onsubmit={save}>
    <h2>{title}</h2>
    <div class="grid">
      <label>Name <input bind:value={p.name} autocomplete="off" list="known-patients" onchange={pickKnown} /></label>
      <datalist id="known-patients">
        {#each [...known.keys()] as n (n)}<option value={n}></option>{/each}
      </datalist>
      <label>ID# <input bind:value={p.id} autocomplete="off" /></label>
      <label
        >Gender
        <select bind:value={p.gender}>
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Date of birth <input type="date" bind:value={p.birthday} /></label>
      {#if imperial}
        <label
          >Height
          <span class="pair"
            ><input type="number" min="0" max="9" bind:value={ft} /> ft
            <input type="number" min="0" max="11" bind:value={inch} /> in</span
          >
        </label>
        <label>Weight (lbs) <input type="number" min="0" step="1" bind:value={lbs} /></label>
      {:else}
        <label>Height (cm) <input type="number" min="0" step="1" bind:value={p.heightCm} /></label>
        <label>Weight (kg) <input type="number" min="0" step="0.1" bind:value={p.weightKg} /></label>
      {/if}
      <label class="wide">Physician <input bind:value={p.physician} /></label>
      <label class="wide">Note <textarea rows="3" bind:value={p.note}></textarea></label>
    </div>
    <div class="actions">
      <button type="button" onclick={() => dlg.close()}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--surface);
    color: var(--text);
    padding: 1.5rem 1.5rem 1.25rem;
    width: min(560px, calc(100vw - 2rem));
    box-shadow: var(--shadow-pop, 0 10px 40px rgb(0 0 0 / 25%));
  }
  dialog::backdrop {
    background: rgb(10 12 16 / 45%);
    backdrop-filter: blur(3px);
  }
  h2 {
    margin-bottom: 1.1rem;
    font-size: var(--fs-lg, 1.15rem);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-sm, 0.85rem);
    font-weight: 500;
    color: var(--text-2);
  }
  label input,
  label select,
  label textarea {
    color: var(--text);
    font: inherit;
    font-size: 0.95rem;
  }
  textarea {
    resize: vertical;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .pair input {
    width: 4.5rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin: 1.3rem -1.5rem 0;
    padding: 1rem 1.5rem 0;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 500px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
