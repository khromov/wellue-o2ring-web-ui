<script lang="ts">
  import { onMount } from 'svelte'
  import { app, log } from '../app.svelte'
  import type { DeviceSession, SettingDef } from '../devices/types'
  import { READ_ONLY_BRANCH_CODES } from '../devices/models'

  let { session }: { session: DeviceSession } = $props()

  let defs = $state<SettingDef[]>([])
  let loading = $state(false)
  let saving = $state<string | null>(null)
  let error = $state('')
  // Bumped on every (re)load so the controls re-render from the device's values,
  // even when a write was rejected and the value didn't change.
  let gen = $state(0)
  // FDA-cleared variants: ViHealth hides these settings and O2 Insight refuses the device.
  const readOnly = $derived(READ_ONLY_BRANCH_CODES.has((app.info?.branchCode ?? '').trim()))
  const disabled = $derived(!!saving || readOnly || !!app.download)

  async function load() {
    loading = true
    error = ''
    try {
      defs = await session.getSettings()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
      gen++
    }
  }

  async function change(d: SettingDef, value: number, el: HTMLInputElement | HTMLSelectElement) {
    const label = d.kind === 'toggle' ? (value ? 'on' : 'off') : (d.options?.find((o) => o.value === value)?.label ?? value)
    if (!confirm(`Change "${d.label}" to ${label} on the device?`)) {
      // Revert the control to the device value.
      if (el instanceof HTMLInputElement) el.checked = d.value !== 0
      else el.value = String(d.value)
      return
    }
    saving = d.key
    try {
      await session.writeSetting(d.key, value)
      log('info', `Set ${d.key} = ${value}`)
      defs = await session.getSettings()
      gen++
    } catch (e) {
      app.error = `Could not change setting: ${e instanceof Error ? e.message : String(e)}`
      log('error', app.error)
      await load()
    } finally {
      saving = null
    }
  }

  onMount(load)
</script>

<section class="card settings">
  <div class="head">
    <h2>Device settings</h2>
    <button disabled={loading || !!app.download} onclick={load}>Reload</button>
  </div>
  {#if readOnly}
    <p class="muted note">This device variant doesn't allow changing settings from an app.</p>
  {/if}
  {#if error}
    <p class="err">{error}</p>
  {:else if loading && !defs.length}
    <p class="muted">Loading…</p>
  {/if}
  {#key gen}
  <div class="form">
    {#each defs as d (d.key)}
      <div class="field">
        <div class="lbl">
          <span>{d.label}</span>
          {#if d.help}<span class="muted help">{d.help}</span>{/if}
        </div>
        {#if d.kind === 'toggle'}
          <label class="switch">
            <input
              type="checkbox"
              checked={d.value !== 0}
              {disabled}
              onchange={(e) => change(d, e.currentTarget.checked ? 1 : 0, e.currentTarget)}
            />
            <span></span>
          </label>
        {:else}
          <select
            value={d.value}
            {disabled}
            onchange={(e) => change(d, Number(e.currentTarget.value), e.currentTarget)}
          >
            {#each d.options ?? [] as o}
              <option value={o.value}>{o.label}</option>
            {/each}
          </select>
        {/if}
      </div>
    {/each}
  </div>
  {/key}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.8rem;
  }
  .form {
    display: flex;
    flex-direction: column;
  }
  .field {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  .field:last-child {
    border-bottom: none;
  }
  .lbl {
    display: flex;
    flex-direction: column;
  }
  .help {
    font-size: 0.8rem;
  }
  .err {
    color: var(--danger);
  }
  .note {
    margin: 0 0 0.6rem;
    font-size: 0.85rem;
  }
  .switch {
    position: relative;
    width: 40px;
    height: 22px;
    flex: none;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch span {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .switch span::after {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    top: 2px;
    background: white;
    border-radius: 50%;
    transition: transform 0.15s;
    box-shadow: 0 1px 2px rgb(0 0 0 / 30%);
  }
  .switch input:checked + span {
    background: var(--accent);
  }
  .switch input:checked + span::after {
    transform: translateX(18px);
  }
  .switch input:focus-visible + span {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
