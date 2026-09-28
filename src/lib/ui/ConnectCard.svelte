<script lang="ts">
  import { app, connectBle, connectUsb, importFiles, savePrefs } from '../app.svelte'
  import { MODELS } from '../devices/models'
  import Icon from './Icon.svelte'

  let fileInput: HTMLInputElement
  // Several catalogue entries share a display name (e.g. WPS variants).
  const supported = [...new Set(MODELS.map((m) => m.name))]
</script>

<section class="card connect">
  <div class="art" aria-hidden="true">
    <svg viewBox="0 0 200 200" class="ring-art">
      <circle class="wave w3" cx="100" cy="100" r="92" />
      <circle class="wave w2" cx="100" cy="100" r="74" />
      <circle class="wave w1" cx="100" cy="100" r="56" />
      <circle class="band" cx="100" cy="104" r="38" />
      <circle class="band-inner" cx="100" cy="104" r="27" />
      <rect class="screen" x="76" y="50" width="48" height="30" rx="8" />
      <text class="screen-num" x="100" y="71" text-anchor="middle">98</text>
    </svg>
  </div>

  <div class="body">
    <p class="overline">Get started</p>
    <h2>Connect your oximeter</h2>
    <ol class="steps">
      <li><span class="n">1</span><span>Put the ring on (or tap its screen) so it wakes up and starts advertising.</span></li>
      <li>
        <span class="n">2</span><span
          >Only one app can be connected at a time. Close ViHealth or O2 Insight on your phone or computer first.</span
        >
      </li>
      <li><span class="n">3</span><span>Click <b>Connect</b> and choose the ring in the browser's Bluetooth dialog.</span></li>
    </ol>

    <div class="actions">
      <button class="primary big" onclick={connectBle} disabled={!app.support.ble || app.connecting}>
        {#if app.connecting}
          <Icon name="loader" size={18} class="spin" />
        {:else}
          <Icon name="bluetooth" size={18} />
        {/if}
        Connect via Bluetooth
      </button>
      <div class="alt">
        <button onclick={connectUsb} disabled={!app.support.hid || app.connecting} title="O2Ring S on its USB cable">
          <Icon name="usb" size={16} />
          USB cable (O2Ring S)
        </button>
        <button onclick={() => fileInput.click()}>
          <Icon name="upload" size={16} />
          Import file…
        </button>
      </div>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        hidden
        onchange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files
          if (f?.length) void importFiles(f).then(() => (app.tab = 'recordings'))
          ;(e.currentTarget as HTMLInputElement).value = ''
        }}
      />
    </div>

    {#if app.connecting && app.status}
      <p class="status" role="status"><span class="pulse" aria-hidden="true"></span>{app.status}</p>
    {/if}

    {#if !app.support.ble}
      <p class="warn">
        <Icon name="alert" size={18} />
        <span>
          This browser doesn't support Web Bluetooth. Use Chrome or Edge on desktop or Android. On Linux, enable
          <span class="mono">chrome://flags/#enable-web-bluetooth</span>.
        </span>
      </p>
    {/if}

    <label class="opt">
      <input type="checkbox" bind:checked={app.prefs.syncTime} onchange={savePrefs} />
      <span>
        Set the device clock to this computer's time on connect
        <span class="muted">As the official apps do.</span>
      </span>
    </label>

    <div class="supported">
      <span class="overline">Supported devices</span>
      <ul class="models">
        {#each supported as m (m)}<li>{m}</li>{/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .connect {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 2.4rem;
    align-items: center;
    padding: 2.4rem 2.6rem;
    max-width: 980px;
    width: 100%;
    margin: 1rem auto 0;
  }
  .art {
    display: grid;
    place-items: center;
    align-self: stretch;
    border-radius: calc(var(--radius) - 4px);
    background:
      radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--spo2) 14%, transparent), transparent 65%),
      var(--surface-2);
    min-height: 260px;
  }
  .ring-art {
    width: min(240px, 80%);
    height: auto;
  }
  .wave {
    fill: none;
    stroke: var(--spo2);
    stroke-width: 1.5;
    opacity: 0.18;
  }
  .w1 {
    opacity: 0.35;
  }
  .w2 {
    opacity: 0.22;
  }
  .w3 {
    opacity: 0.12;
  }
  .band {
    fill: none;
    stroke: var(--text);
    stroke-width: 13;
    opacity: 0.88;
  }
  .band-inner {
    fill: none;
    stroke: var(--text-2);
    stroke-width: 1.5;
    opacity: 0.5;
  }
  .screen {
    fill: #0b0d10;
    stroke: var(--surface);
    stroke-width: 3;
  }
  .screen-num {
    fill: #5b9cff;
    font: 700 17px system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  .overline {
    margin: 0 0 -0.6rem;
  }
  h2 {
    font-size: var(--fs-xl);
    letter-spacing: -0.02em;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    color: var(--text-2);
  }
  .steps li {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
  }
  .steps b {
    color: var(--text);
    font-weight: 600;
  }
  .n {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 700;
    margin-top: 0.05rem;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.3rem;
  }
  .big {
    min-height: 2.9rem;
    padding: 0 1.4rem;
    font-size: var(--fs-md);
    border-radius: 11px;
    align-self: flex-start;
  }
  .alt {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .big :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .status .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--spo2);
    animation: blink 1s ease-in-out infinite alternate;
  }
  @keyframes blink {
    to {
      opacity: 0.25;
    }
  }
  .warn {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    margin: 0;
    padding: 0.7rem 0.85rem;
    border-radius: var(--radius-sm);
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--warn) 28%, transparent);
    font-size: var(--fs-sm);
  }
  .opt {
    display: flex;
    gap: 0.65rem;
    align-items: flex-start;
    padding: 0.75rem 0.85rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .opt input {
    margin: 0.1rem 0 0;
  }
  .opt > span {
    display: flex;
    flex-direction: column;
  }
  .supported {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-top: 0.2rem;
  }
  .models {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
  }
  .models li {
    font-size: var(--fs-xs);
    font-weight: 550;
    padding: 0.25rem 0.55rem;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
  }
  @media (max-width: 760px) {
    .connect {
      grid-template-columns: 1fr;
      gap: 1.4rem;
      padding: 1.2rem;
      margin-top: 0;
    }
    .art {
      min-height: 170px;
    }
    .ring-art {
      width: 150px;
    }
    .big {
      align-self: stretch;
    }
    .alt button {
      flex: 1;
    }
  }
</style>
