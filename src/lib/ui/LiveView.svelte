<script lang="ts">
  import { app, MOTION_HISTORY, toggleLive } from '../app.svelte'
  import Icon from './Icon.svelte'

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
  // Same trace, closed along the bottom edge for the soft fill under the line.
  const area = $derived(path ? `${path}V${H}H0Z` : '')

  // Motion trend: one bar per poll, newest on the right. The ring's live motion
  // is sparse (0 when still), so a short history makes brief movements visible.
  const MH = 28
  const motionBars = $derived.by(() => {
    const h = app.motionHist
    const max = Math.max(32, ...h.map((v) => v ?? 0))
    const bw = W / MOTION_HISTORY
    const offset = MOTION_HISTORY - h.length
    return h.map((v, i) => ({
      x: (offset + i) * bw,
      w: Math.max(1, bw - 1.5),
      h: v === null ? 0 : v === 0 ? 1 : Math.max(2, (v / max) * MH),
      zero: v === 0,
      none: v === null,
    }))
  })
</script>

<section class="card live" class:unavailable={usb} class:on={app.liveOn}>
  <div class="head">
    <div class="title">
      <h2>Live</h2>
      {#if app.liveOn}<span class="chip live-chip"><span class="rec" aria-hidden="true"></span>Live</span>{/if}
    </div>
    <button class:primary={!app.liveOn && !usb} disabled={usb || (!app.liveOn && !!app.download)} onclick={toggleLive}
      >{app.liveOn ? 'Stop' : 'Start'} live view</button
    >
  </div>
  <div class="values">
    <div class="v spo2">
      <span class="label"><Icon name="droplet" size={14} />SpO₂</span>
      <span class="reading"><span class="num">{live?.spo2 ?? '--'}</span><span class="unit">%</span></span>
    </div>
    <div class="v pr">
      <span class="label"><Icon name="heart" size={14} />Pulse</span>
      <span class="reading"><span class="num">{live?.pr ?? '--'}</span><span class="unit">bpm</span></span>
    </div>
    <div class="minor">
      <div class="m pi">
        <span class="label">PI</span>
        <span class="reading"><span class="num small">{live?.pi?.toFixed(1) ?? '--'}</span><span class="unit">%</span></span>
      </div>
      <div class="m motion">
        <span class="label">Motion</span>
        <span class="reading"><span class="num small">{live?.motion ?? '--'}</span></span>
      </div>
    </div>
  </div>
  <div class="wave-box">
    <svg class="wave" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-label="Pleth waveform">
      <path class="area" d={area} />
      <path class="line" d={path} />
    </svg>
  </div>
  <div class="motion-strip">
    <span class="label">Motion · last 2 min</span>
    <svg viewBox="0 0 {W} {MH}" preserveAspectRatio="none" role="img" aria-label="Motion over the last two minutes">
      {#each motionBars as b, i (i)}
        {#if !b.none}<rect class:zero={b.zero} x={b.x} y={MH - b.h} width={b.w} height={b.h} rx="1" />{/if}
      {/each}
    </svg>
  </div>
  <p class="status">
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
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .live-chip {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 11%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.6667rem;
  }
  .rec {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    animation: blink 1.4s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .values {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.5rem 1rem;
    align-items: end;
  }
  .v,
  .m {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .spo2 .label {
    color: var(--spo2);
  }
  .pr .label {
    color: var(--pr);
  }
  .reading {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }
  .num {
    font-size: 3.4rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.035em;
    line-height: 0.95;
  }
  .num.small {
    font-size: 1.35rem;
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .unit {
    font-size: 0.9333rem;
    font-weight: 550;
    color: var(--text-2);
  }
  .spo2 .num {
    color: var(--spo2);
  }
  .pr .num {
    color: var(--pr);
  }
  .minor {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-left: 1rem;
    border-left: 1px solid var(--border);
    min-width: 5.5rem;
  }
  .m {
    gap: 0.15rem;
  }
  .wave-box {
    margin-top: 1.1rem;
    border-radius: var(--radius-sm);
    background-color: var(--surface-2);
    background-image:
      linear-gradient(color-mix(in srgb, var(--border-strong) 45%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--border-strong) 45%, transparent) 1px, transparent 1px);
    background-size: 100% 25%, 8.333% 100%;
    background-position: 0 -1px, -1px 0;
    overflow: hidden;
  }
  .wave {
    display: block;
    width: 100%;
    height: 116px;
  }
  .wave .line {
    fill: none;
    stroke: var(--pleth);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .wave .area {
    fill: color-mix(in srgb, var(--pleth) 12%, transparent);
    stroke: none;
  }
  .motion-strip {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .motion-strip .label {
    flex: none;
    font-size: 0.6667rem;
  }
  .motion-strip svg {
    flex: 1;
    min-width: 0;
    height: 28px;
    border-bottom: 1px solid var(--border);
  }
  .motion-strip rect {
    fill: var(--motion);
  }
  .motion-strip rect.zero {
    fill: var(--border-strong);
  }
  .unavailable .values,
  .unavailable .motion-strip,
  .unavailable .wave-box {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .status {
    margin: 0.6rem 0 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
    min-height: 1.2em;
  }
  @media (max-width: 520px) {
    .values {
      grid-template-columns: 1fr 1fr;
    }
    .minor {
      grid-column: 1 / -1;
      flex-direction: row;
      gap: 1.5rem;
      padding: 0.6rem 0 0;
      border-left: none;
      border-top: 1px solid var(--border);
    }
    .num {
      font-size: 3rem;
    }
  }
</style>
