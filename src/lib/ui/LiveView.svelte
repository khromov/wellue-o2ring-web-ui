<script lang="ts">
  import { app, toggleLive } from '../app.svelte'

  const live = $derived(app.live)
  // The ring's sensor stays off while it's on the USB cable (it's charging), so
  // live readings are only meaningful over Bluetooth.
  const usb = $derived(app.session?.transport.kind === 'hid')
  const charging = $derived(app.battery?.state === 'charging' || app.battery?.state === 'full')
  const RUN_TEXT: Record<string, string> = {
    idle: 'Idle',
    preparing: 'Preparing to record',
    measuring: 'Recording',
    finished: 'Recording finished',
  }
  const sensorText: Record<string, string> = {
    ok: '',
    'no-finger': 'No finger detected',
    'probe-off': 'Probe unplugged',
    fault: 'Sensor fault',
    unknown: '',
  }

  const W = 600
  const H = 90
  const path = $derived.by(() => {
    const w = app.wave
    if (w.length < 2) return ''
    let lo = Infinity
    let hi = -Infinity
    for (const v of w) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo || 1
    const n = 600
    const start = Math.max(0, w.length - n)
    let d = ''
    for (let i = start; i < w.length; i++) {
      const x = ((i - start) / (n - 1)) * W
      // Invert: the device's PPG rises downwards.
      const y = 4 + ((w[i] - lo) / span) * (H - 8)
      d += `${i === start ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }
    return d
  })
</script>

<section class="card live" class:unavailable={usb}>
  <div class="head">
    <h2>Live</h2>
    <button class:primary={!app.liveOn && !usb} disabled={usb} onclick={toggleLive}
      >{app.liveOn ? 'Stop' : 'Start'} live view</button
    >
  </div>
  <div class="values">
    <div class="v spo2">
      <span class="label">SpO₂</span>
      <span class="num">{live?.spo2 ?? '--'}</span><span class="unit">%</span>
    </div>
    <div class="v pr">
      <span class="label">Pulse</span>
      <span class="num">{live?.pr ?? '--'}</span><span class="unit">bpm</span>
    </div>
    <div class="v pi">
      <span class="label">PI</span>
      <span class="num small">{live?.pi?.toFixed(1) ?? '--'}</span><span class="unit">%</span>
    </div>
    <div class="v motion">
      <span class="label">Motion</span>
      <span class="num small">{live?.motion ?? '--'}</span>
    </div>
  </div>
  <svg class="wave" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-label="Pleth waveform">
    <path d={path} />
  </svg>
  <p class="status muted">
    {#if usb}
      Not available over USB: the ring doesn't measure while it's on the cable. Connect over Bluetooth with the ring on
      your finger.
    {:else if !app.liveOn}
      Live readings are polled from the device while this is on.
    {:else if live}
      {#if live.sensor !== 'ok' && charging}
        The ring doesn't measure while charging. Take it off the charger and put it on.
      {:else}
        {sensorText[live.sensor] || RUN_TEXT[live.status ?? ''] || live.status}
      {/if}
    {:else}
      Waiting for data…
    {/if}
  </p>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.8rem;
  }
  .values {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .v {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.15rem;
  }
  .label {
    width: 100%;
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .num {
    font-size: 2.4rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .num.small {
    font-size: 1.5rem;
  }
  .unit {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .spo2 .num {
    color: var(--spo2);
  }
  .pr .num {
    color: var(--pr);
  }
  .wave {
    width: 100%;
    height: 90px;
    margin-top: 0.8rem;
    background: var(--surface-2);
    border-radius: 6px;
  }
  .wave path {
    fill: none;
    stroke: var(--ok);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .unavailable .values,
  .unavailable .wave {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .status {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    min-height: 1.2em;
  }
</style>
