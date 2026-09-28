<script lang="ts">
  import { app } from '../app.svelte'

  let el: HTMLDivElement
  $effect(() => {
    void app.log.length
    if (el) el.scrollTop = el.scrollHeight
  })

  function ts(t: number) {
    const d = new Date(t)
    return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }

  function copy() {
    void navigator.clipboard.writeText(app.log.map((l) => `${ts(l.t)} ${l.dir.toUpperCase()} ${l.text}`).join('\n'))
  }
</script>

<section class="card log">
  <div class="head">
    <h3>Protocol log</h3>
    <div class="row">
      <button class="small" onclick={copy}>Copy</button>
      <button class="small" onclick={() => (app.log = [])}>Clear</button>
    </div>
  </div>
  <div class="lines mono" bind:this={el}>
    {#each app.log as l (l)}
      <div class={l.dir}><span class="t">{ts(l.t)}</span> <span class="d">{l.dir}</span> {l.text}</div>
    {/each}
  </div>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .lines {
    max-height: 260px;
    overflow: auto;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .t {
    color: var(--text-2);
  }
  .d {
    display: inline-block;
    width: 3.5em;
    font-weight: 600;
  }
  .tx .d {
    color: var(--accent);
  }
  .rx .d {
    color: var(--ok);
  }
  .error {
    color: var(--danger);
  }
  .small {
    font-size: 0.8rem;
    padding: 0.2rem 0.6rem;
  }
</style>
