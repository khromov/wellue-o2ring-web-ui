<script lang="ts">
  import uPlot from 'uplot'
  import 'uplot/dist/uPlot.min.css'
  import { onDestroy, onMount } from 'svelte'

  interface Props {
    /** Builds options for a given width; called on (re)creation. */
    options: (width: number) => uPlot.Options
    data: uPlot.AlignedData
    height?: number
    /** Called with the live instance, e.g. to hook zoom events. */
    onCreate?: (u: uPlot) => void
  }

  let { options, data, height = 260, onCreate }: Props = $props()

  let el: HTMLDivElement
  let plot: uPlot | null = null
  let ro: ResizeObserver | null = null

  let lastOptions: Props['options'] | null = null
  let printing = false

  function create() {
    lastOptions = options
    plot?.destroy()
    // Canvas charts don't reflow for print: re-render at page width with the light palette.
    const width = printing ? 680 : el.clientWidth || 600
    plot = new uPlot({ ...options(width), width, height }, data, el)
    onCreate?.(plot)
  }

  function beforePrint() {
    document.documentElement.dataset.print = '1'
    printing = true
    create()
  }

  function afterPrint() {
    delete document.documentElement.dataset.print
    printing = false
    create()
  }

  onMount(() => {
    create()
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    ro = new ResizeObserver(() => {
      if (printing) return
      if (plot && el.clientWidth && Math.abs(plot.width - el.clientWidth) > 1) {
        plot.setSize({ width: el.clientWidth, height })
      }
    })
    ro.observe(el)
  })

  // Recreate when options change; cheap update when only data changes.
  $effect(() => {
    const d = data
    const o = options
    if (!plot) return
    if (o !== lastOptions) {
      create()
    } else {
      plot.setData(d)
    }
  })

  onDestroy(() => {
    window.removeEventListener('beforeprint', beforePrint)
    window.removeEventListener('afterprint', afterPrint)
    ro?.disconnect()
    plot?.destroy()
    plot = null
  })
</script>

<div class="uplot-wrap" bind:this={el}></div>

<style>
  .uplot-wrap {
    width: 100%;
    min-width: 0;
  }
  .uplot-wrap :global(.u-legend) {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  @media print {
    .uplot-wrap :global(.u-legend) {
      display: none;
    }
  }
  .uplot-wrap :global(.u-select) {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
</style>
