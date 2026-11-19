import { onTestFinished, vi } from "vitest";

/**
 * Keeps a test that fills a fixed rate-limit window off the window's edge.
 * The limiters count in windows aligned to the clock (`floor(now / windowMs)`),
 * so a test that fills one must not straddle two. Waiting out the edge can take
 * longer than the test timeout, so near the edge (within `marginMs` of its end)
 * this freezes `Date` at the middle of the current window instead, until the
 * test finishes. Only `Date` is faked: timers, sockets and the database run on
 * the real clock. Away from the edge it does nothing, so the real clock runs.
 */
export function stayInWindow(windowMs: number, marginMs = 90_000): void {
	const now = Date.now();
	if (windowMs - (now % windowMs) >= marginMs) return;
	vi.useFakeTimers({
		toFake: ["Date"],
		now: now - (now % windowMs) + windowMs / 2,
	});
	onTestFinished(() => {
		vi.useRealTimers();
	});
}
