<script lang="ts">
  import {
    app,
    cancelDownload,
    downloadFiles,
    log,
    refreshBattery,
    refreshDeviceFiles,
  } from '../app.svelte'
  import type { DeviceSession } from '../devices/types'
  import LiveView from './LiveView.svelte'
  import SettingsForm from './SettingsForm.svelte'

  let { session }: { session: DeviceSession } = $props()

  let busy = $state(false)
  const info = $derived(session.info)
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
    void run(async () => {
      await session.syncTime()
      await session.refreshInfo()
    })
  }

  const batteryLabel: Record<string, string> = {
    normal: '',
    charging: 'charging',
    full: 'charged',
    low: 'low',
  }

  function prettyName(n: string): string {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(n)
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : n
  }
</script>

<div class="grid">
  <section class="card info">
    <div class="head">
      <h2>{info?.model ?? session.transport.name}</h2>
      {#if app.battery}
        <span class="battery" class:low={app.battery.state === 'low'}>
          <span class="bar"><span style="width: {Math.min(100, app.battery.percent)}%"></span></span>
          {app.battery.percent} %
          {#if batteryLabel[app.battery.state]}<span class="muted">{batteryLabel[app.battery.state]}</span>{/if}
        </span>
      {/if}
    </div>
    <dl>
      <dt>Serial</dt>
      <dd class="mono">{info?.sn || '—'}</dd>
      <dt>Firmware</dt>
      <dd>{info?.fwVersion ?? '—'} <span class="muted">(HW {info?.hwVersion ?? '?'}, BL {info?.bootloaderVersion ?? '?'})</span></dd>
      <dt>Device clock</dt>
      <dd>{info?.deviceTime ?? '—'}</dd>
      <dt>Connection</dt>
      <dd>{session.transport.kind === 'ble' ? 'Bluetooth' : 'USB'} · {session.transport.name}</dd>
      {#if info?.extra}
        {#each Object.entries(info.extra) as [k, v]}
          <dt class="muted">{k}</dt>
          <dd class="muted mono">{v}</dd>
        {/each}
      {/if}
    </dl>
    <div class="row">
      <button disabled={busy} onclick={() => run(async () => { await session.refreshInfo(); await refreshBattery() })}>Refresh</button>
      <button disabled={busy} onclick={syncClock}>Set clock</button>
    </div>
  </section>

  <LiveView />

  <section class="card files">
    <div class="head">
      <h2>Recordings on device</h2>
      <div class="row">
        <button disabled={busy || !!app.download} onclick={() => run(refreshDeviceFiles)}>Refresh</button>
        <button class="primary" disabled={!newFiles.length || !!app.download} onclick={() => downloadFiles(newFiles)}>
          Download {newFiles.length ? `${newFiles.length} new` : 'new'}
        </button>
      </div>
    </div>
    {#if app.download}
      <div class="progress">
        <div class="row">
          <span>
            Downloading {app.download.index + 1}/{app.download.count}: {prettyName(app.download.name)}
          </span>
          <button class="small" onclick={cancelDownload}>Cancel</button>
        </div>
        <progress max={app.download.total || 1} value={app.download.done}></progress>
        <span class="muted small">
          {(app.download.done / 1024).toFixed(1)} / {(app.download.total / 1024).toFixed(1)} KiB
        </span>
      </div>
    {/if}
    {#if app.deviceFiles.length === 0}
      <p class="muted">No recordings stored on the device.</p>
    {:else}
      <table>
        <thead><tr><th>Recording</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each app.deviceFiles as f (f.name)}
            <tr>
              <td>{prettyName(f.name)}</td>
              <td>
                {#if f.stored}<span class="ok">Downloaded</span>{:else if f.removed}<span class="muted">Removed locally</span>{:else}<span
                    class="muted">New</span
                  >{/if}
              </td>
              <td class="right">
                <button class="small" disabled={!!app.download} onclick={() => downloadFiles([f.name])}>
                  {f.stored ? 'Re-download' : 'Download'}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="muted small">
        Downloaded recordings are kept in this browser and appear under Recordings. Nothing is deleted from the device.
      </p>
    {/if}
  </section>

  <SettingsForm {session} />
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .files {
    grid-column: 1 / -1;
  }
  @media (max-width: 800px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.8rem;
    flex-wrap: wrap;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .battery {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .battery .bar {
    width: 28px;
    height: 12px;
    border: 1.5px solid var(--text-2);
    border-radius: 3px;
    padding: 1px;
    display: inline-block;
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
  .progress {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.8rem;
  }
  progress {
    width: 100%;
  }
  .small {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
  }
  p.small {
    padding: 0;
    margin: 0.6rem 0 0;
  }
  .ok {
    color: var(--ok);
  }
  .right {
    text-align: right;
  }
</style>
