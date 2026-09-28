<script lang="ts" generics="T extends string">
  import { onMount, tick } from 'svelte'

  interface Item {
    id: T
    label: string
    badge?: number
  }

  let { items, active, onSelect }: { items: Item[]; active: T; onSelect: (id: T) => void } = $props()

  let scroller: HTMLDivElement
  let canLeft = $state(false)
  let canRight = $state(false)

  function update() {
    if (!scroller) return
    canLeft = scroller.scrollLeft > 2
    canRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2
  }

  function nudge(dir: -1 | 1) {
    scroller.scrollBy({ left: dir * Math.max(120, scroller.clientWidth * 0.6), behavior: 'smooth' })
  }

  // Keep the active tab visible when it changes.
  $effect(() => {
    void active
    void tick().then(() => {
      scroller?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      update()
    })
  })

  onMount(() => {
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    update()
    return () => ro.disconnect()
  })
</script>

<nav class="scrollnav" class:fade-left={canLeft} class:fade-right={canRight} aria-label="Sections">
  <button class="arrow left" class:show={canLeft} tabindex="-1" aria-hidden="true" onclick={() => nudge(-1)}>
    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 6l-6 6 6 6" /></svg>
  </button>
  <div class="scroller" bind:this={scroller} onscroll={update}>
    {#each items as it (it.id)}
      <button
        class="tab"
        class:active={active === it.id}
        aria-current={active === it.id ? 'page' : undefined}
        onclick={() => onSelect(it.id)}
      >
        {it.label}
        {#if it.badge}<span class="count">{it.badge}</span>{/if}
      </button>
    {/each}
  </div>
  <button class="arrow right" class:show={canRight} tabindex="-1" aria-hidden="true" onclick={() => nudge(1)}>
    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" /></svg>
  </button>
</nav>

<style>
  .scrollnav {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .scroller {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-behavior: smooth;
    min-width: 0;
    flex: 1;
    -webkit-overflow-scrolling: touch;
  }
  .scroller::-webkit-scrollbar {
    display: none;
  }
  /* Fade the clipped edge so it reads as "more this way". */
  .fade-left .scroller {
    mask-image: linear-gradient(to right, transparent 0, #000 2rem);
  }
  .fade-right .scroller {
    mask-image: linear-gradient(to left, transparent 0, #000 2rem);
  }
  .fade-left.fade-right .scroller {
    mask-image: linear-gradient(to right, transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%);
  }
  .tab {
    border: none;
    background: none;
    color: var(--text-2);
    flex: none;
  }
  .tab.active {
    color: var(--text);
    background: var(--surface-2);
  }
  .count {
    font-size: 0.75rem;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0 0.45rem;
  }
  .tab.active .count {
    background: var(--border);
  }
  .arrow {
    position: absolute;
    top: 50%;
    z-index: 1;
    transform: translateY(-50%);
    width: 26px;
    height: 26px;
    padding: 0;
    justify-content: center;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .arrow.show {
    opacity: 1;
    pointer-events: auto;
  }
  .arrow.left {
    left: -4px;
  }
  .arrow.right {
    right: -4px;
  }
  .arrow svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
