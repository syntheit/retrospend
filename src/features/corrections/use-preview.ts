"use client";

import { useEffect, useRef, useState } from "react";
import { useSettled } from "../entry/shared-ui";

type Preview<O> = {
	/** The last answer, which may be for an input a moment ago (keeps the block from flickering). */
	data: O | null;
	/** The answer is for the input as it stands now: Save may go. */
	fresh: boolean;
	loading: boolean;
	/** The server's reason the write would be refused, as a sentence. */
	error: string | null;
};

/**
 * The server's dry run of a write whose preview is a mutation (R30): runs
 * `run` once the input has been still for a moment and keeps only the
 * answer to the latest input. A null input has nothing to preview.
 */
export function usePreview<I, O>(
	run: (input: I) => Promise<O>,
	input: I | null,
): Preview<O> {
	const settled = useSettled(input, 350);
	const key = settled === null ? null : JSON.stringify(settled);
	const now = input === null ? null : JSON.stringify(input);
	const latest = useRef(run);
	latest.current = run;
	const [state, setState] = useState<{
		key: string;
		data: O | null;
		error: string | null;
	} | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized input
	useEffect(() => {
		if (settled === null || key === null) return;
		let live = true;
		latest
			.current(settled)
			.then((data) => live && setState({ key, data, error: null }))
			.catch(
				(e: unknown) =>
					live &&
					setState({
						key,
						data: null,
						error: e instanceof Error ? e.message : "",
					}),
			);
		return () => {
			live = false;
		};
	}, [key]);

	const fresh = state !== null && state.key === now;
	return {
		data: state?.data ?? null,
		fresh: fresh && state.error === null,
		error: fresh ? state.error : null,
		loading: now !== null && !fresh,
	};
}
