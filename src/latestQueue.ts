/**
 * Serialises async work where only the newest request matters: a task queued
 * behind others is skipped if something newer arrived, and a running task can
 * ask whether it is still the latest before touching shared state.
 */
export class LatestQueue {
	private generation = 0;
	private tail: Promise<void> = Promise.resolve();

	run(task: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
		const mine = ++this.generation;
		const isCurrent = () => mine === this.generation;
		const next = this.tail
			.catch(() => {})
			.then(async () => {
				if (isCurrent()) await task(isCurrent);
			});
		this.tail = next;
		return next;
	}

	/** Supersedes everything queued or running. */
	invalidate(): void {
		this.generation++;
	}
}
