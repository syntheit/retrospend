/**
 * Mounts for the native hosts of long-press rows, one at a time. A list of
 * hundreds of rows used to mount a SwiftUI host per row in the very render
 * that painted it, which is what made first paint and the first scroll
 * stall. A row now paints as a plain row and asks here for its host: the
 * queue lets one row per tick take it, after the frame that painted the rows.
 */
const waiting: (() => void)[] = [];
let pumping = false;

/** Rows per tick; one keeps a frame short on the oldest phones. */
const PER_TICK = 1;
const TICK_MS = 32;

function step() {
	for (let i = 0; i < PER_TICK; i++) waiting.shift()?.();
	if (waiting.length > 0) setTimeout(step, TICK_MS);
	else pumping = false;
}

function pump() {
	if (pumping) return;
	pumping = true;
	// After the frame that painted the rows, not inside it.
	setTimeout(step, TICK_MS);
}

/** Queues `mount`; the returned function takes it back (the row unmounted). */
export function whenIdle(mount: () => void): () => void {
	waiting.push(mount);
	pump();
	return () => {
		const at = waiting.indexOf(mount);
		if (at >= 0) waiting.splice(at, 1);
	};
}

/** How many rows are still waiting for a host (tests). */
export function queued(): number {
	return waiting.length;
}
