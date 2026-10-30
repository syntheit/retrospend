import { useEffect, useRef } from "react";

/**
 * Passing UI that should not outlive the moment: an open swipe row, an open
 * menu, bulk-select mode. Each registers how to close itself while it is
 * open, and leaving a tab closes them all (Tabs), so coming back finds the
 * tab as it was minus the half-finished gesture. The tab's stack, its scroll
 * and an iPad's list-detail selection are not transient and stay.
 */
const closers = new Set<() => void>();

/** Closes every open transient (a tab switch). */
export function closeTransients(): void {
	for (const close of [...closers]) close();
}

/**
 * Registers `close` while it is not null. Pass null when the thing is
 * closed, so the set only holds what is open.
 */
export function useTransient(close: (() => void) | null): void {
	const latest = useRef(close);
	latest.current = close;
	const open = close !== null;
	useEffect(() => {
		if (!open) return;
		const entry = () => latest.current?.();
		closers.add(entry);
		return () => {
			closers.delete(entry);
		};
	}, [open]);
}
