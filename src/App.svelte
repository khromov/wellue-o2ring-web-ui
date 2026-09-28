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
  import Icon from './lib/ui/Icon.svelte'
  import type { Tab } from './lib/app.svelte'

  const tabs = $derived<{ id: Tab; label: string; badge?: number; icon: string }[]>([
    { id: 'device', label: 'Device', icon: 'ring' },
    { id: 'recordings', label: 'Recordings', badge: app.files.length, icon: 'moon' },
    { id: 'trends', label: 'Trends', icon: 'trends' },
    { id: 'options', label: 'Options', icon: 'sliders' },
  ])
  const ble = $derived(app.session?.transport.kind === 'ble')

  onMount(() => {
    void refreshStoredFiles()
  })

</script>

<header class="top">
  <div class="brand">
    <span class="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="3" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      </svg>
    </span>
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
      <span class="status ok" title="Connected via {ble ? 'Bluetooth' : 'USB'}">
        <span class="dot"></span>
        <span class="model">{app.session.info?.model ?? app.session.transport.name}</span>
        <span class="kind"><Icon name={ble ? 'bluetooth' : 'usb'} size={13} /><span class="kind-label">{ble ? 'Bluetooth' : 'USB'}</span></span>
      </span>
      <button class="ghost disc" onclick={disconnect} title="Disconnect" aria-label="Disconnect">
        <Icon name="unplug" size={16} />
        <span class="label">Disconnect</span>
      </button>
    {:else if app.connecting}
      <span class="status"><Icon name="loader" size={14} class="spin" />{app.status || 'Connecting…'}</span>
    {:else}
      <span class="status"><span class="dot off"></span>Not connected</span>
    {/if}
  </div>
</header>

<main>
  {#if app.error}
    <div class="banner error" role="alert">
      <Icon name="alert" size={18} />
      <span class="msg">{app.error}</span>
      <button class="ghost icon dismiss" onclick={() => (app.error = '')} aria-label="Dismiss"><Icon name="x" size={16} /></button>
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

<!-- Phone-width navigation: the same tabs as a bottom tab bar (the top tab row is hidden there). -->
<nav class="tabbar no-print" aria-label="Sections">
  {#each tabs as t (t.id)}
    <button class:active={app.tab === t.id} aria-current={app.tab === t.id ? 'page' : undefined} onclick={() => (app.tab = t.id)}>
      <span class="ic">
        <Icon name={t.icon} size={21} />
        {#if t.badge}<span class="badge">{t.badge}</span>{/if}
      </span>
      <span class="lbl">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
    grid-template-areas: 'brand nav conn';
    align-items: center;
    gap: 0.5rem 1rem;
    min-height: 3.6rem;
    padding: 0.5rem 1.2rem;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    grid-area: brand;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-text);
    flex: none;
  }
  .brand h1 {
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.015em;
    white-space: nowrap;
  }
  .nav {
    grid-area: nav;
    min-width: 0;
  }
  .conn {
    grid-area: conn;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .status {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--fs-sm);
    font-weight: 550;
    height: 2rem;
    padding: 0 0.7rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-2);
  }
  .status.ok {
    color: var(--text);
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--text-2);
    padding-left: 0.45rem;
    border-left: 1px solid var(--border-strong);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent);
  }
  .dot.off {
    background: var(--text-2);
    box-shadow: none;
    opacity: 0.7;
  }
  .status :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .disc {
    height: 2rem;
    min-height: 2rem;
    padding: 0 0.6rem;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .disc:hover:not(:disabled) {
    color: var(--danger);
  }

  @media (max-width: 1180px) {
    .disc .label {
      display: none;
    }
    .disc {
      width: 2rem;
      padding: 0;
    }
  }
  /* Tablet: brand + status on top, the tab row below. */
  @media (max-width: 900px) {
    .top {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'brand conn'
        'nav nav';
      padding: 0.5rem 1rem 0.55rem;
    }
    .disc .label {
      display: none;
    }
  }
  /* Phone: tabs move to the bottom bar. */
  @media (max-width: 640px) {
    .top {
      grid-template-areas: 'brand conn';
      min-height: 3.2rem;
      padding: 0.45rem 1rem;
    }
    .nav {
      display: none;
    }
    .kind-label {
      display: none;
    }
    .disc {
      width: 2rem;
      padding: 0;
    }
  }
  @media (max-width: 480px) {
    .status .model {
      display: none;
    }
    .kind {
      border-left: none;
      padding-left: 0;
    }
    /* Make room for the live reading when it's shown. */
    .top:has(.conn > :global(.badge)) .brand h1 {
      display: none;
    }
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.4rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.5rem 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-weight: 550;
  }
  .banner .msg {
    flex: 1;
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 10%, var(--surface));
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  }
  .dismiss {
    color: inherit;
    width: 2rem;
    min-height: 2rem;
  }
  footer {
    max-width: 1200px;
    margin: 0.6rem auto 2rem;
    padding: 0 1.2rem;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: var(--fs-xs);
  }
  footer a {
    text-underline-offset: 3px;
  }

  .tabbar {
    display: none;
  }
  @media (max-width: 640px) {
    main {
      padding: 1rem 0.9rem;
    }
    footer {
      padding: 0 1rem;
      margin-bottom: calc(5.5rem + env(safe-area-inset-bottom));
    }
    .tabbar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      padding: 0.35rem 0.4rem calc(0.35rem + env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      backdrop-filter: blur(14px) saturate(1.4);
      -webkit-backdrop-filter: blur(14px) saturate(1.4);
      border-top: 1px solid var(--border);
    }
    .tabbar button {
      flex-direction: column;
      gap: 0.15rem;
      min-height: 3.3rem;
      padding: 0.2rem 0;
      border: none;
      background: none;
      color: var(--text-2);
      font-size: 0.7333rem;
      font-weight: 600;
    }
    .tabbar button:hover:not(:disabled) {
      background: none;
    }
    .tabbar .ic {
      position: relative;
      display: grid;
      place-items: center;
      width: 3.6rem;
      height: 1.95rem;
      border-radius: 999px;
      transition: background-color 0.15s;
    }
    .tabbar button.active {
      color: var(--text);
    }
    .tabbar button.active .ic {
      background: var(--surface-3);
    }
    .tabbar .badge {
      position: absolute;
      top: -2px;
      right: 0.55rem;
      min-width: 1.05rem;
      height: 1.05rem;
      padding: 0 0.25rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-text);
      font-size: 0.6667rem;
      line-height: 1.05rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
  }
  @media print {
    .top,
    footer,
    .banner,
    .tabbar {
      display: none !important;
    }
    main {
      padding: 0;
      max-width: none;
    }
  }
</style>
