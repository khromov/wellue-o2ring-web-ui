import type { LiveSample } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Real-time polling shared by both sessions. Each loop gets a generation
 * number, so a quick stop/start never leaves two loops running, and
 * `exclusive()` pauses polling around file transfers and setting writes (the
 * vendor apps stop real-time polling for those too).
 */
export class LivePoller {
  private gen = 0
  private loop: Promise<void> | null = null
  private loopGen = -1
  private cb: ((s: LiveSample) => void) | null = null
  private paused = 0

  constructor(
    private poll: () => Promise<LiveSample | null>,
    private isClosed: () => boolean,
    private periodMs = 1000,
  ) {}

  get wanted(): boolean {
    return this.cb !== null
  }

  /** True while a transfer / setting write holds the device. */
  get busy(): boolean {
    return this.paused > 0
  }

  start(cb: (s: LiveSample) => void): void {
    this.cb = cb
    this.kick()
  }

  async stop(): Promise<void> {
    this.cb = null
    await this.halt()
  }

  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.paused++
    try {
      await this.halt()
      return await fn()
    } finally {
      this.paused--
      this.kick()
    }
  }

  private kick(): void {
    if (!this.cb || this.paused > 0 || this.isClosed()) return
    if (this.loop) {
      // A stale loop is still winding down: start again once it has.
      if (this.loopGen !== this.gen) void this.loop.then(() => this.kick())
      return
    }
    const my = this.gen
    this.loopGen = my
    const p = (async () => {
      await sleep(300)
      while (my === this.gen && this.cb && !this.isClosed()) {
        const t0 = Date.now()
        try {
          const s = await this.poll()
          if (s && my === this.gen) this.cb?.(s)
        } catch (e) {
          if (this.isClosed()) break
          console.warn('live poll failed', e)
        }
        await sleep(Math.max(0, this.periodMs - (Date.now() - t0)))
      }
    })()
    this.loop = p
    void p.finally(() => {
      if (this.loop === p) this.loop = null
    })
  }

  private async halt(): Promise<void> {
    this.gen++
    const l = this.loop
    if (l) await l
    if (this.loop === l) this.loop = null
  }
}
