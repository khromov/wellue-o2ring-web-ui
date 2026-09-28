<script lang="ts">
  import { app } from '../app.svelte'

  // Condensed live reading for the header, shown when live view runs on another tab.
  const live = $derived(app.live)
</script>

<button class="badge" onclick={() => (app.tab = 'device')} title="Live reading. Open the device page.">
  <span class="rec" aria-hidden="true"></span>
  <span class="v spo2"><span class="k">SpO₂</span>{live?.spo2 ?? '--'}<small>%</small></span>
  <span class="sep" aria-hidden="true"></span>
  <span class="v pr"
    ><svg viewBox="0 0 24 24" width="12" height="12" aria-label="Pulse"
      ><path d="M12 21s-7-4.5-9.3-9A5.2 5.2 0 0 1 12 6a5.2 5.2 0 0 1 9.3 6C19 16.5 12 21 12 21z" /></svg
    >{live?.pr ?? '--'}</span
  >
</button>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2rem;
    min-height: 2rem;
    padding: 0 0.75rem 0 0.6rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    font-variant-numeric: tabular-nums;
    font-size: 0.9333rem;
  }
  .rec {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
    animation: blink 1.4s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  .sep {
    width: 1px;
    height: 0.9rem;
    background: var(--border-strong);
  }
  .v {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .k {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-2);
    margin-right: 0.1rem;
  }
  small {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .spo2 {
    color: var(--spo2);
  }
  .pr {
    color: var(--pr);
    align-items: center;
  }
  .pr svg {
    fill: currentColor;
    margin-right: 0.1rem;
  }
</style>
