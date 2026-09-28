<script lang="ts">
  import { onMount } from 'svelte'
  import { app, disconnect, refreshStoredFiles } from './lib/app.svelte'
  import ConnectCard from './lib/ui/ConnectCard.svelte'
  import DeviceView from './lib/ui/DeviceView.svelte'
  import RecordingsView from './lib/ui/RecordingsView.svelte'
  import DebugLog from './lib/ui/DebugLog.svelte'
  import TrendsView from './lib/ui/TrendsView.svelte'
  import OptionsView from './lib/ui/OptionsView.svelte'
  import ScrollNav from './lib/ui/ScrollNav.svelte'
  import LiveBadge from './lib/ui/LiveBadge.svelte'
  import type { Tab } from './lib/app.svelte'

  const tabs = $derived<{ id: Tab; label: string; badge?: number }[]>([
    { id: 'device', label: 'Device' },
    { id: 'recordings', label: 'Recordings', badge: app.files.length },
    { id: 'trends', label: 'Trends' },
    { id: 'options', label: 'Options' },
  ])
  const kind = $derived(app.session?.transport.kind === 'ble' ? 'BLE' : 'USB')

  onMount(() => {
    void refreshStoredFiles()
  })

</script>

<header class="top">
  <div class="brand">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="3" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
    <h1>O2Ring Web</h1>
  </div>
  <div class="nav">
    <ScrollNav items={tabs} active={app.tab} onSelect={(id) => (app.tab = id)} />
  </div>
  <div class="conn">
    {#if app.liveOn && app.tab !== 'device'}
      <LiveBadge />
    {/if}
    {#if app.session}
      <span class="pill ok" title="Connected via {kind === 'BLE' ? 'Bluetooth' : 'USB'}">
        <span class="dot"></span>
        <span class="model">{app.session.info?.model ?? app.session.transport.name}</span>
        <span class="muted">{kind}</span>
      </span>
      <button class="disc" onclick={disconnect} title="Disconnect" aria-label="Disconnect">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        <span class="label">Disconnect</span>
      </button>
    {:else if app.connecting}
      <span class="pill"><span class="dot pulse"></span>{app.status || 'Connecting…'}</span>
    {:else}
      <span class="pill"><span class="dot off"></span>Not connected</span>
    {/if}
  </div>
</header>

<main>
  {#if app.error}
    <div class="banner error" role="alert">
      <span>{app.error}</span>
      <button class="link" onclick={() => (app.error = '')} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  {#if app.tab === 'device'}
    {#if app.session}
      <DeviceView session={app.session} />
    {:else}
      <ConnectCard />
    {/if}
  {:else if app.tab === 'recordings'}
    <RecordingsView />
  {:else if app.tab === 'trends'}
    <TrendsView />
  {:else}
    <OptionsView />
  {/if}

  {#if app.prefs.debug}
    <DebugLog />
  {/if}
</main>

<footer>
  <span class="muted">
    Unofficial tool for Wellue / Viatom oximeters. Not a medical device. Recordings stay in this browser.
  </span>
  <a class="muted" href="https://github.com/khromov/wellue-o2ring-web-ui" target="_blank" rel="noreferrer">Source</a>
</footer>

<style>
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'brand nav conn';
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.6rem 1.2rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    grid-area: brand;
  }
  .nav {
    grid-area: nav;
    min-width: 0;
  }
  .conn {
    grid-area: conn;
  }
  /* Narrow screens: brand + status on top, a full-width scrolling tab row below. */
  @media (max-width: 960px) {
    .top {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'brand conn'
        'nav nav';
      padding: 0.5rem 0.9rem 0.4rem;
    }
    .conn {
      justify-self: end;
      gap: 0.4rem;
    }
    .disc .label {
      display: none;
    }
    .disc {
      padding: 0.35rem;
    }
  }
  @media (max-width: 480px) {
    .brand h1 {
      font-size: 0.95rem;
    }
    .pill .model {
      display: none;
    }
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--accent);
  }
  .brand h1 {
    font-size: 1.05rem;
    color: var(--text);
  }
  .conn {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .disc svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .disc svg {
    display: none;
  }
  @media (max-width: 960px) {
    .disc svg {
      display: block;
    }
  }
  .pill {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }
  .dot.off {
    background: var(--text-2);
  }
  .dot.pulse {
    background: var(--accent);
    animation: pulse 1s infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 0.9rem;
    border-radius: 8px;
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 12%, var(--surface));
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  }
  .link {
    border: none;
    background: none;
    color: inherit;
    padding: 0.1rem 0.4rem;
  }
  footer {
    max-width: 1200px;
    margin: 1rem auto 2rem;
    padding: 0 1.2rem;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.8rem;
  }
  @media print {
    .top,
    footer,
    .banner {
      display: none !important;
    }
    main {
      padding: 0;
      max-width: none;
    }
  }
  @media (max-width: 600px) {
    .top {
      padding: 0.5rem 1rem;
    }
    main {
      padding: 1rem;
    }
  }
</style>
