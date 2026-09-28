<script lang="ts">
  import { app, connectBle, connectUsb, importFiles, savePrefs } from '../app.svelte'
  import { MODELS } from '../devices/models'

  let fileInput: HTMLInputElement
  const supported = MODELS.map((m) => m.name)
</script>

<section class="card connect">
  <div class="hero">
    <h2>Connect your oximeter</h2>
    <p class="muted">
      Put the ring on (or tap its screen) so it wakes up and starts advertising, then choose it in the browser's
      Bluetooth dialog. Only one app can be connected at a time. Close ViHealth or O2 Insight on your phone or computer first.
    </p>
  </div>

  <div class="actions">
    <button class="primary big" onclick={connectBle} disabled={!app.support.ble || app.connecting}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        ><path
          d="M7 7l10 10-5 5V2l5 5L7 17"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      Connect via Bluetooth
    </button>
    <button onclick={connectUsb} disabled={!app.support.hid || app.connecting} title="O2Ring S on its USB cable">
      USB cable (O2Ring S)
    </button>
    <button onclick={() => fileInput.click()}>Import file…</button>
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
    <p class="status">{app.status}</p>
  {/if}

  {#if !app.support.ble}
    <p class="warn">
      This browser doesn't support Web Bluetooth. Use Chrome or Edge on desktop or Android. On Linux, enable
      <span class="mono">chrome://flags/#enable-web-bluetooth</span>.
    </p>
  {/if}

  <label class="opt">
    <input type="checkbox" bind:checked={app.prefs.syncTime} onchange={savePrefs} />
    Set the device clock to this computer's time on connect (as the official apps do)
  </label>

  <details>
    <summary class="muted">Supported devices</summary>
    <p class="muted small">{supported.join(', ')}</p>
  </details>
</section>

<style>
  .connect {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.6rem;
  }
  .hero p {
    margin: 0.4rem 0 0;
    max-width: 60ch;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .big {
    padding: 0.65rem 1.2rem;
    font-size: 1rem;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  .status {
    margin: 0;
    color: var(--text-2);
  }
  .opt {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.85rem;
  }
  details summary {
    cursor: pointer;
    font-size: 0.9rem;
  }
</style>
