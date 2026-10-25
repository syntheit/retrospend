"use client";

import { useRef } from "react";
import type { Diff } from "./figure-changes";
import { type DryRun, useDryRun } from "./use-dry-run";
import { useBudgetWrite } from "./use-write";

/**
 * A money sheet's whole write path (R30, R15): the server's dry run of
 * `input` (`preview`), Save through the same mutation (`commit`), the page
 * refreshed, then one toast with Undo that runs `undo`. Tokens for undo come
 * from what the write returned, never from client math. `ready` is true only
 * while the dry run answers for the input on screen.
 */
export function useMoneyWrite<I, P extends Diff, R>(o: {
	input: I | null;
	preview: (input: I) => Promise<P>;
	commit: (input: I) => Promise<R>;
	/** The toast text, from what was written. */
	toast: (result: R, input: I) => string;
	/** The inverse write, or none when the write moves no money to take back. */
	undo?: (result: R, input: I) => (() => Promise<unknown>) | undefined;
	/** Runs after the write, before the toast (a follow-up read). */
	after?: (result: R, input: I) => void;
}): {
	dry: DryRun<P>;
	ready: boolean;
	submit: () => Promise<false | undefined>;
} {
	const { refresh, saved } = useBudgetWrite();
	const dry = useDryRun(o.preview, o.input);
	const latest = useRef(o);
	latest.current = o;
	const submit = async () => {
		const { input, commit, toast, undo, after } = latest.current;
		if (input === null) return false;
		const result = await commit(input);
		await refresh();
		after?.(result, input);
		saved(toast(result, input), undo?.(result, input));
		return undefined;
	};
	return { dry, ready: dry.status === "ready", submit };
}
