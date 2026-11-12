export type SaveStatus = { kind: 'saved' | 'saving' } | { kind: 'error'; message: string };

// One writer; edits arriving during a write replace only the next snapshot.
export class SaveQueue<T> {
  private pending: { value: T } | undefined;
  private running: Promise<void> | undefined;

  private write: (value: T) => Promise<void>;
  private report: (status: SaveStatus) => void;

  constructor(write: (value: T) => Promise<void>, report: (status: SaveStatus) => void) {
    this.write = write;
    this.report = report;
  }

  enqueue(value: T): void {
    this.pending = { value };
    void this.flush().catch(() => { /* The error is shown; the pending snapshot is kept for retry. */ });
  }

  async flush(): Promise<void> {
    while (this.pending || this.running) {
      if (!this.running) {
        this.report({ kind: 'saving' });
        this.running = this.drain().finally(() => { this.running = undefined; });
      }
      await this.running;
    }
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const snapshot = this.pending;
      try {
        await this.write(snapshot.value);
      } catch (error) {
        this.report({ kind: 'error', message: String(error) });
        throw error;
      }
      if (this.pending === snapshot) this.pending = undefined;
    }
    this.report({ kind: 'saved' });
  }
}
