<script lang="ts">
  // Renders an fmtDur() string ("6h38m29s") with the unit letters set smaller: 6h 38m 29s.
  let { value }: { value: string } = $props()
  const parts = $derived([...value.matchAll(/(\d+)([a-z]+)/g)].map((m) => [m[1], m[2]] as const))
</script>

{#if parts.length}{#each parts as [n, u], i (i)}{#if i}&thinsp;{/if}{n}<small class="u">{u}</small>{/each}{:else}{value}{/if}

<style>
  .u {
    font-size: 0.6em;
    font-weight: 600;
    color: var(--text-2);
    margin-left: 0.04em;
    letter-spacing: 0;
  }
</style>
