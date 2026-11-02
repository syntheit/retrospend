import { useEffect, useRef } from "react";

/**
 * Runs `reset` each time a sheet opens, so a second opening never shows what
 * the first left behind (fields, picks, write ids). It runs after the render
 * that opened the sheet; the latest `reset` is the one called.
 */
export function useResetOnOpen(open: boolean, reset: () => void): void {
	const latest = useRef(reset);
	latest.current = reset;
	useEffect(() => {
		if (open) latest.current();
	}, [open]);
}
