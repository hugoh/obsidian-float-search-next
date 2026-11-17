import { describe, expect, test } from "bun:test";
import { LatestQueue } from "./latestQueue";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe("LatestQueue", () => {
  test("runs tasks one after another", async () => {
    const queue = new LatestQueue();
    const events: string[] = [];
    const first = gate();
    const a = queue.run(async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    await tick();
    const b = queue.run(async () => {
      events.push("b");
    });
    await tick();
    expect(events).toEqual(["a:start"]);
    first.open();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b"]);
  });

  test("skips a queued task that was superseded before it started", async () => {
    const queue = new LatestQueue();
    const first = gate();
    const ran: string[] = [];
    const a = queue.run(() => first.promise);
    const b = queue.run(async () => {
      ran.push("b");
    });
    const c = queue.run(async () => {
      ran.push("c");
    });
    first.open();
    await Promise.all([a, b, c]);
    expect(ran).toEqual(["c"]);
  });

  test("tells a running task when it has been superseded", async () => {
    const queue = new LatestQueue();
    const first = gate();
    const seen: boolean[] = [];
    const a = queue.run(async (isCurrent) => {
      seen.push(isCurrent());
      await first.promise;
      seen.push(isCurrent());
    });
    await tick();
    queue.run(async () => {});
    first.open();
    await a;
    expect(seen).toEqual([true, false]);
  });

  test("invalidate cancels queued work and marks the running task stale", async () => {
    const queue = new LatestQueue();
    const first = gate();
    const seen: boolean[] = [];
    const ran: string[] = [];
    const a = queue.run(async (isCurrent) => {
      await first.promise;
      seen.push(isCurrent());
    });
    await tick();
    const b = queue.run(async () => {
      ran.push("b");
    });
    queue.invalidate();
    first.open();
    await Promise.all([a, b]);
    expect(seen).toEqual([false]);
    expect(ran).toEqual([]);
  });

  test("a failing task does not block later ones", async () => {
    const queue = new LatestQueue();
    const failed = queue.run(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    let ran = false;
    await queue.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
