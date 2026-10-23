"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef } from "react";
import { useToast } from "~/components/ui/toast";

/** One field's change: how to write a value, and the value before and after. */
export type FieldChange<T> = {
	apply: (value: T) => Promise<unknown>;
	next: T;
	prev: T;
	/** What the toast says ("Home currency is now ARS"); "Saved" by default. */
	message?: string;
	/** False when the old value cannot come back (nothing to undo). */
	undoable?: boolean;
	/**
	 * Puts the screen back to `prev` when the write fails (a list or switch
	 * that showed the change before the server had it). Writes nothing.
	 */
	restore?: (prev: T) => void;
	/** The toast for a failure this field can name ("That username is taken"). */
	failedMessage?: (err: unknown) => string | undefined;
};

export type AutosaveReport = {
	saved: (message: string, undo?: () => Promise<unknown>) => void;
	failed: (message: string) => void;
};

/**
 * Writes one field (the autosave model, IMPLEMENTATION §1.1): an unchanged
 * value writes nothing and says nothing (never "Saved" when nothing changed),
 * a change says so with Undo that writes the old value back, a failure says
 * it could not save (in the user's language, never the server's English)
 * and puts the screen back. Returns whether the value was saved.
 */
export async function saveField<T>(
	change: FieldChange<T>,
	report: AutosaveReport,
	copy: { saved: string; failed: string },
	same: (a: T, b: T) => boolean = Object.is,
): Promise<boolean> {
	if (same(change.next, change.prev)) return false;
	try {
		await change.apply(change.next);
	} catch (err) {
		change.restore?.(change.prev);
		report.failed(change.failedMessage?.(err) ?? copy.failed);
		return false;
	}
	const undo =
		change.undoable === false ? undefined : () => change.apply(change.prev);
	report.saved(change.message ?? copy.saved, undo);
	return true;
}

/** saveField with the page's toasts. */
export function useAutosave() {
	const toast = useToast();
	const t = useTranslations("settingsV2.autosave");
	return useCallback(
		<T>(change: FieldChange<T>, same?: (a: T, b: T) => boolean) =>
			saveField(
				change,
				{
					saved: (message, undo) =>
						toast.saved(message, undo ? { undo } : undefined),
					failed: (message) => toast.failed(message),
				},
				{ saved: t("saved"), failed: t("failed") },
				same,
			),
		[toast, t],
	);
}

/**
 * One save per key at a time: a change made while the same field is still
 * saving is dropped, so a double click makes one write and one toast.
 */
export function makeSaveGuard() {
	const busy = new Set<string>();
	return async <R>(
		key: string,
		run: () => Promise<R>,
	): Promise<R | undefined> => {
		if (busy.has(key)) return undefined;
		busy.add(key);
		try {
			return await run();
		} finally {
			busy.delete(key);
		}
	};
}

/** makeSaveGuard for one component's lifetime. */
export function useSaveGuard() {
	return useRef(makeSaveGuard()).current;
}
