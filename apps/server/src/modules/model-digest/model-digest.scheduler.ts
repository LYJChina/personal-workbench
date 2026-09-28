import type { ModelDigestService } from "./model-digest.service.js";

const pollIntervalMs = 60_000;

export class ModelDigestScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollRunning = false;

  public constructor(private readonly service: ModelDigestService, private readonly now: () => Date = () => new Date()) {}

  public start(): () => void {
    if (this.timer) return () => this.stop();
    this.service.recoverInterruptedRuns();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), pollIntervalMs);
    this.timer.unref?.();
    return () => this.stop();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.pollRunning) return;
    this.pollRunning = true;
    try { await this.service.startScheduledRun(this.now()); }
    catch { /* Run status is persisted by the service; scheduler polling must remain alive. */ }
    finally { this.pollRunning = false; }
  }
}
