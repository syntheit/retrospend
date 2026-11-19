// When the enable sheet's draft (the keys the caller made, the recovery key
// text) must be wiped. Every exit ends in `discard`: the sheet closing, the
// sheet unmounting, Back to the password (the caller calls discardDraft), and
// an answer from makeKeys that arrives after the sheet is already gone (a
// closed sheet must not leave the caller holding a fresh draft).
import { useCallback, useEffect, useRef } from "react";

export function useEnableLifecycle({
	open,
	discard,
	reset,
}: {
	open: boolean;
	/** Wipe the caller's draft. Safe to call again. */
	discard: () => void;
	/** Back to the first step with nothing typed. */
	reset: () => void;
}) {
	// The latest callbacks, so the effects below run on `open` and unmount only.
	const latest = useRef({ discard, reset });
	latest.current = { discard, reset };
	// Counts closes and unmounts, so a job knows whether its sheet is the same one.
	const epoch = useRef(0);

	useEffect(() => {
		if (open) return;
		epoch.current += 1;
		latest.current.reset();
		latest.current.discard();
	}, [open]);

	useEffect(
		() => () => {
			epoch.current += 1;
			latest.current.discard();
		},
		[],
	);

	/**
	 * Runs a job that makes a draft. When the sheet closed or unmounted while it
	 * ran, the draft is wiped and the answer is null: nobody is left to use it.
	 */
	const settle = useCallback(async <T>(job: () => Promise<T>) => {
		const started = epoch.current;
		const made = await job();
		if (epoch.current === started) return made;
		latest.current.discard();
		return null;
	}, []);

	const discardDraft = useCallback(() => latest.current.discard(), []);
	return { settle, discardDraft };
}
