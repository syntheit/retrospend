/**
 * Mounts for the native hosts of long-press rows, one at a time. A list of
 * hundreds of rows used to mount a SwiftUI host per row in the very render
 * that painted it, which is what made first paint and the first scroll
 * stall. A row now paints as a plain row and asks here for its host: the
 * queue lets one row per tick take it, once the list has been quiet for a moment (a scroll keeps requesting new rows, so it never mounts under a moving finger).
 */
const waiting: (() => void)[] = [];
let pumping = false;

/** Rows per tick; one keeps a frame short on the oldest phones. */
const PER_TICK = 1;
const TICK_MS = 32;
/** No host mounts while rows are still being requested (a scroll): the list must be quiet this long. */
const QUIET_MS = 200;
let lastAdd = 0;
let scrolling = false;
let scrollEnd = 0;

/**
 * A list is being dragged or is coasting: no host mounts until it has been
 * still for QUIET_MS. The scroll primitives (barScroll) report this.
 */
export function scrollActive(on: boolean): void {
	scrolling = on;
	if (!on) scrollEnd = Date.now();
}

function step() {
	const now = Date.now();
	if (scrolling || now - lastAdd < QUIET_MS || now - scrollEnd < QUIET_MS) {
		setTimeout(step, TICK_MS);
		return;
	}
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
	lastAdd = Date.now();
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
