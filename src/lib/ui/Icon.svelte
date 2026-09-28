<script lang="ts" module>
  // Small inline icon set (Lucide-style 24px grid, 2px round strokes). Presentational only.
  type Part = ['path', string] | ['circle', number, number, number] | ['rect', number, number, number, number, number]

  const ICONS: Record<string, Part[]> = {
    ring: [
      ['circle', 12, 13, 7.5],
      ['circle', 12, 13, 4],
      ['rect', 9.5, 2.5, 5, 3, 1],
    ],
    bluetooth: [['path', 'm7 7 10 10-5 5V2l5 5L7 17']],
    usb: [['path', 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z']],
    upload: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12']],
    download: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3']],
    moon: [['path', 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z']],
    trends: [['path', 'M3 3v16a2 2 0 0 0 2 2h16M19 9l-5 5-4-4-3 3']],
    sliders: [
      [
        'path',
        'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
      ],
    ],
    heart: [
      [
        'path',
        'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
      ],
    ],
    droplet: [['path', 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z']],
    activity: [['path', 'M22 12h-4l-3 9L9 3l-3 9H2']],
    refresh: [
      [
        'path',
        'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
      ],
    ],
    clock: [
      ['circle', 12, 12, 9.5],
      ['path', 'M12 7v5l3 2'],
    ],
    unplug: [
      [
        'path',
        'm19 5 3-3M2 22l3-3M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4ZM7.5 13.5 10 11M10.5 16.5 13 14M12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z',
      ],
    ],
    user: [
      ['path', 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'],
      ['circle', 12, 7, 4],
    ],
    printer: [
      ['path', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V3h12v6'],
      ['rect', 6, 14, 12, 8, 1],
    ],
    file: [['path', 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4']],
    table: [
      ['rect', 3, 3, 18, 18, 2],
      ['path', 'M3 9h18M3 15h18M9 9v12'],
    ],
    pencil: [
      [
        'path',
        'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4',
      ],
    ],
    'chevron-left': [['path', 'm15 18-6-6 6-6']],
    'chevron-right': [['path', 'm9 18 6-6-6-6']],
    'chevron-down': [['path', 'm6 9 6 6 6-6']],
    select: [['path', 'm3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8']],
    trash: [['path', 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2']],
    alert: [['path', 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01']],
    info: [
      ['circle', 12, 12, 9.5],
      ['path', 'M12 16v-4M12 8h.01'],
    ],
    x: [['path', 'M18 6 6 18M6 6l12 12']],
    reset: [['path', 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5']],
    inbox: [
      [
        'path',
        'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      ],
    ],
    calendar: [
      ['path', 'M8 2v4M16 2v4M3 10h18'],
      ['rect', 3, 4, 18, 18, 2],
    ],
    check: [['path', 'M20 6 9 17l-5-5']],
    loader: [['path', 'M21 12a9 9 0 1 1-6.22-8.56']],
    cpu: [
      ['rect', 5, 5, 14, 14, 2],
      ['path', 'M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3'],
    ],
  }
</script>

<script lang="ts">
  let {
    name,
    size = 18,
    stroke = 2,
    class: cls = '',
    label,
  }: { name: string; size?: number; stroke?: number; class?: string; label?: string } = $props()

  const parts = $derived(ICONS[name] ?? [])
</script>

<svg
  class="icon {cls}"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {#each parts as p, i (i)}
    {#if p[0] === 'path'}
      <path d={p[1]} />
    {:else if p[0] === 'circle'}
      <circle cx={p[1]} cy={p[2]} r={p[3]} />
    {:else}
      <rect x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={p[5]} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
