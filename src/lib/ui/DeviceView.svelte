<script lang="ts">
  import {
    app,
    cancelDownload,
    downloadFiles,
    log,
    refreshDeviceFiles,
    refreshInfo,
    syncClock as syncDeviceClock,
  } from '../app.svelte'
  import type { DeviceSession } from '../devices/types'
  import LiveView from './LiveView.svelte'
  import SettingsForm from './SettingsForm.svelte'
  import Icon from './Icon.svelte'

  let { session }: { session: DeviceSession } = $props()

  let busy = $state(false)
  const info = $derived(app.info)
  // No other commands while a file transfer is running (the vendor apps don't mix them either).
  const locked = $derived(busy || !!app.download)
  const newFiles = $derived(app.deviceFiles.filter((f) => !f.stored && !f.removed).map((f) => f.name))

  async function run(fn: () => Promise<unknown>) {
    busy = true
    try {
      await fn()
    } catch (e) {
      app.error = e instanceof Error ? e.message : String(e)
      log('error', app.error)
    } finally {
      busy = false
    }
  }

  function syncClock() {
    if (!confirm('Set the device clock to this computer’s current time?')) return
    void run(syncDeviceClock)
  }

  const batteryLabel: Record<string, string> = {
    normal: '',
    charging: 'charging',
    full: 'charged',
    low: 'low',
  }

  const ble = $derived(session.transport.kind === 'ble')
  const pct = $derived(app.download && app.download.total ? Math.round((app.download.done / app.download.total) * 100) : 0)

  function prettyName(n: string): string {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(n)
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : n
  }
</script>

<div class="dash">
  <div class="col">
    <LiveView />

    <section class="card files">
      <div class="head">
        <div class="title">
          <h2>Recordings on device</h2>
          {#if app.deviceFiles.length}<span class="chip">{app.deviceFiles.length}</span>{/if}
        </div>
        <div class="row">
          <button class="ghost icon" disabled={locked} onclick={() => run(refreshDeviceFiles)} title="Refresh" aria-label="Refresh"
            ><Icon name="refresh" size={17} /></button
          >
          <button class="primary" disabled={!newFiles.length || locked} onclick={() => downloadFiles(newFiles)}>
            <Icon name="download" size={16} />
            <span><span class="dl-word">Download{' '}</span>{newFiles.length ? `${newFiles.length} new` : 'new'}</span>
          </button>
        </div>
      </div>
      {#if app.download}
        <div class="progress">
          <div class="prow">
            <span class="pl">
              Downloading {app.download.index + 1}/{app.download.count}: <b>{prettyName(app.download.name)}</b>
            </span>
            <button class="small" onclick={cancelDownload}>Cancel</button>
          </div>
          <progress max={app.download.total || 1} value={app.download.done}></progress>
          <span class="muted small">
            {(app.download.done / 1024).toFixed(1)} / {(app.download.total / 1024).toFixed(1)} KiB · {pct} %
          </span>
        </div>
      {/if}
      {#if app.deviceFiles.length === 0}
        <div class="empty">
          <span class="empty-icon"><Icon name="inbox" size={22} /></span>
          <p class="muted">No recordings stored on the device.</p>
        </div>
      {:else}
        <table class="ftable">
          <thead><tr><th>Recording</th><th>Status</th><th><span class="sr">Action</span></th></tr></thead>
          <tbody>
            {#each app.deviceFiles as f (f.name)}
              {@const [d, t] = prettyName(f.name).split(' ')}
              <tr>
                <td class="when"><span class="d">{d}</span> <span class="t">{t}</span></td>
                <td class="st">
                  {#if f.stored}<span class="chip ok"><Icon name="check" size={12} stroke={2.6} />Downloaded</span
                    >{:else if f.removed}<span class="chip">Removed locally</span>{:else}<span class="chip info">New</span>{/if}
                </td>
                <td class="right">
                  <button class="small" disabled={locked} onclick={() => downloadFiles([f.name])}>
                    {f.stored ? 'Re-download' : 'Download'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="note">
          <Icon name="info" size={14} />
          Downloaded recordings are kept in this browser and appear under Recordings. Nothing is deleted from the device.
        </p>
      {/if}
    </section>
  </div>

  <div class="col">
    <section class="card info">
      <div class="dev">
        <span class="dev-icon"><Icon name="ring" size={22} /></span>
        <div class="dev-name">
          <h2>{info?.model ?? session.transport.name}</h2>
          <span class="sub"
            ><Icon name={ble ? 'bluetooth' : 'usb'} size={12} />{ble ? 'Bluetooth' : 'USB'} · {session.transport.name}</span
          >
        </div>
        {#if app.battery}
          <span class="battery" class:low={app.battery.state === 'low'}>
            <span class="bar"><span style="width: {Math.min(100, app.battery.percent)}%"></span></span>
            {app.battery.percent} %
            {#if batteryLabel[app.battery.state]}<span class="muted">{batteryLabel[app.battery.state]}</span>{/if}
          </span>
        {/if}
      </div>
      <dl class="facts">
        <div><dt>Serial</dt><dd class="mono">{info?.sn || '—'}</dd></div>
        <div>
          <dt>Firmware</dt>
          <dd>{info?.fwVersion ?? '—'} <span class="muted">(HW {info?.hwVersion ?? '?'}, BL {info?.bootloaderVersion ?? '?'})</span></dd>
        </div>
        <div><dt>Device clock</dt><dd class="num">{info?.deviceTime ?? '—'}</dd></div>
      </dl>
      {#if info?.extra && Object.keys(info.extra).length}
        <details class="tech">
          <summary><Icon name="chevron-right" size={14} class="chev" />Technical details</summary>
          <dl class="facts">
            {#each Object.entries(info.extra) as [k, v] (k)}
              <div><dt>{k}</dt><dd class="mono">{v}</dd></div>
            {/each}
          </dl>
        </details>
      {/if}
      <div class="row actions">
        <button class="small" disabled={locked} onclick={() => run(refreshInfo)}><Icon name="refresh" size={14} />Refresh</button>
        <button class="small" disabled={locked} onclick={syncClock}><Icon name="clock" size={14} />Set clock</button>
      </div>
    </section>

    <SettingsForm {session} />
  </div>
</div>

<style>
  .dash {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  @media (max-width: 860px) {
    .dash {
      grid-template-columns: 1fr;
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Device card */
  .dev {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .dev-icon {
    display: grid;
    place-items: center;
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    flex: none;
  }
  .dev-name {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .sub {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--fs-sm);
    color: var(--text-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    font-size: 0.9333rem;
  }
  .facts > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border);
  }
  dt {
    color: var(--text-2);
    flex: none;
  }
  dd {
    margin: 0;
    text-align: right;
    overflow-wrap: anywhere;
  }
  .tech {
    border-top: 1px solid var(--border);
    padding-top: 0.55rem;
  }
  .tech summary {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--fs-sm);
    color: var(--text-2);
    list-style: none;
  }
  .tech summary::-webkit-details-marker {
    display: none;
  }
  .tech :global(.chev) {
    transition: transform 0.15s;
  }
  .tech[open] :global(.chev) {
    transform: rotate(90deg);
  }
  .tech .facts {
    margin-top: 0.4rem;
    font-size: var(--fs-sm);
  }
  .actions {
    margin-top: 0.9rem;
  }
  .battery {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--fs-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    background: var(--surface-2);
    flex: none;
  }
  .battery .bar {
    position: relative;
    width: 24px;
    height: 11px;
    border: 1.5px solid var(--text-2);
    border-radius: 3px;
    padding: 1px;
    display: inline-block;
  }
  .battery .bar::after {
    content: '';
    position: absolute;
    right: -4px;
    top: 2.5px;
    width: 2px;
    height: 3px;
    border-radius: 0 1px 1px 0;
    background: var(--text-2);
  }
  .battery .bar span {
    display: block;
    height: 100%;
    background: var(--ok);
    border-radius: 1px;
  }
  .battery.low .bar span {
    background: var(--danger);
  }

  /* Files card */
  .progress {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 1rem;
    padding: 0.8rem 0.9rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .prow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.9333rem;
  }
  .pl b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  progress {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-3);
  }
  progress::-webkit-progress-bar {
    background: var(--surface-3);
    border-radius: 999px;
  }
  progress::-webkit-progress-value {
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.2s;
  }
  progress::-moz-progress-bar {
    background: var(--accent);
    border-radius: 999px;
  }
  .ftable td {
    padding: 0.6rem 0.5rem;
    vertical-align: middle;
  }
  .when {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .when .d {
    font-weight: 550;
  }
  .when .t {
    color: var(--text-2);
    margin-left: 0.3rem;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .small {
    font-size: var(--fs-xs);
    padding: 0 0.65rem;
  }
  span.small {
    font-size: var(--fs-xs);
    padding: 0;
    margin: 0;
  }
  .note {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.8rem 0 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .right {
    text-align: right;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.6rem 1rem;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    text-align: center;
  }
  .empty p {
    margin: 0;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
  }
  /* Phone: keep the title and its two actions on one row; the button reads "⤓ 1 new"
     (the word "Download" stays in the accessible name). */
  @media (max-width: 520px) {
    .files .head {
      flex-wrap: nowrap;
    }
    .files .title {
      flex: 1;
      min-width: 0;
      flex-wrap: wrap;
      row-gap: 0.15rem;
    }
    .files .title h2 {
      font-size: var(--fs-md);
    }
    .files .head .row {
      flex: none;
      flex-wrap: nowrap;
      gap: 0.3rem;
    }
    .dl-word {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
  @media (max-width: 520px) {
    .ftable thead {
      display: none;
    }
    .ftable tr {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas:
        'when btn'
        'st btn';
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding: 0.45rem 0;
    }
    .ftable tr:last-child {
      border-bottom: none;
    }
    .ftable td {
      border: none;
      padding: 0.1rem 0.25rem;
    }
    .ftable .when {
      grid-area: when;
    }
    .ftable .st {
      grid-area: st;
    }
    .ftable .right {
      grid-area: btn;
    }
  }
</style>
