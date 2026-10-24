"use client";

import { useEffect, useRef, useState } from "react";

export type DryRun<O> =
	| { status: "idle"; preview: null }
	| { status: "loading"; preview: O | null }
	| { status: "ready"; preview: O }
	| { status: "error"; preview: null; code: string | null };

/** The tRPC error code of a refused dry run, when there is one. */
function codeOf(error: unknown): string | null {
	const data = (error as { data?: { code?: unknown } } | null)?.data;
	return typeof data?.code === "string" ? data.code : null;
}

/**
 * The server's dry run of a money write (R30): the same mutation Save makes,
 * rolled back. It waits for typing to settle, runs once per distinct input
 * (inputs are plain JSON, so their text is their identity) and never shows an
 * answer for an input that is no longer on screen. `null` input: nothing to
 * preview yet. While a new answer loads, the last one stays visible and is
 * marked `loading`, so the block does not flash.
 */
export function useDryRun<I, O>(
	run: (input: I) => Promise<O>,
	input: I | null,
	delay = 250,
): DryRun<O> {
	const key = input === null ? null : JSON.stringify(input);
	const latest = useRef({ run, input });
	latest.current = { run, input };
	const [state, setState] = useState<{
		key: string | null;
		value: DryRun<O>;
	}>({ key: null, value: { status: "idle", preview: null } });

	useEffect(() => {
		if (key === null) {
			setState({ key: null, value: { status: "idle", preview: null } });
			return;
		}
		let current = true;
		setState((s) => ({
			key,
			value: { status: "loading", preview: s.value.preview },
		}));
		const timer = setTimeout(() => {
			const given = latest.current.input;
			if (given === null) return;
			latest.current
				.run(given)
				.then((preview) => {
					if (current) setState({ key, value: { status: "ready", preview } });
				})
				.catch((error: unknown) => {
					if (current)
						setState({
							key,
							value: { status: "error", preview: null, code: codeOf(error) },
						});
				});
		}, delay);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [key, delay]);

	// An answer for an older input is not an answer for this one.
	return state.key === key ? state.value : { status: "loading", preview: null };
}
