<script lang="ts">
  import { onMount } from 'svelte'
  import { app, log } from '../app.svelte'
  import type { DeviceSession, SettingDef } from '../devices/types'
  import { READ_ONLY_BRANCH_CODES } from '../devices/models'
  import Icon from './Icon.svelte'

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
    <button class="ghost small" disabled={loading || !!app.download} onclick={load}><Icon name="refresh" size={14} />Reload</button>
  </div>
  {#if readOnly}
    <p class="note"><Icon name="info" size={15} />This device variant doesn't allow changing settings from an app.</p>
  {/if}
  {#if error}
    <p class="err"><Icon name="alert" size={15} />{error}</p>
  {:else if loading && !defs.length}
    <div class="skeleton" aria-label="Loading…" role="status">
      {#each [62, 48, 70, 55, 40] as w, i (i)}
        <div class="sk-row"><span class="sk" style="width:{w}%"></span><span class="sk ctl"></span></div>
      {/each}
    </div>
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
              role="switch"
              aria-label={d.label}
              checked={d.value !== 0}
              {disabled}
              onchange={(e) => change(d, e.currentTarget.checked ? 1 : 0, e.currentTarget)}
            />
            <span></span>
          </label>
        {:else}
          <select
            value={d.value}
            aria-label={d.label}
            {disabled}
            onchange={(e) => change(d, Number(e.currentTarget.value), e.currentTarget)}
          >
            {#each d.options ?? [] as o, i (i)}
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
    margin-bottom: 0.4rem;
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
    min-height: 3.2rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border);
  }
  .field:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .lbl {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    font-weight: 500;
  }
  .help {
    font-size: var(--fs-xs, 0.8rem);
    font-weight: 400;
  }
  .err,
  .note {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0.3rem 0 0.6rem;
    padding: 0.6rem 0.75rem;
    border-radius: var(--radius-sm, 8px);
    font-size: var(--fs-sm, 0.85rem);
  }
  .err {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, var(--surface));
  }
  .note {
    color: var(--text-2);
    background: var(--surface-2);
  }
  .skeleton {
    display: flex;
    flex-direction: column;
  }
  .sk-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 3.2rem;
    border-bottom: 1px solid var(--border);
  }
  .sk {
    height: 0.8rem;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: shimmer 1.3s ease-in-out infinite;
  }
  .sk.ctl {
    width: 5.5rem;
    height: 1.8rem;
    border-radius: 8px;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  select {
    flex: none;
  }
  .switch {
    position: relative;
    width: 42px;
    height: 24px;
    flex: none;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch span {
    position: absolute;
    inset: 0;
    background: var(--surface-3, var(--border));
    border: 1px solid var(--border-strong, var(--border));
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
    box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
  }
  .switch input:checked + span {
    background: var(--control-on, var(--accent));
    border-color: transparent;
  }
  .switch input:checked + span::after {
    transform: translateX(18px);
  }
  .switch input:disabled + span {
    opacity: 0.5;
    cursor: default;
  }
  .switch input:focus-visible + span {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
  }
</style>
