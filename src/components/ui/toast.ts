"use client";

/**
 * Toast: confirms a finished action and offers Undo (R15). Sonner is the
 * engine (the one Toaster is mounted in the root layout); this module is the
 * only way new code shows a toast. It keeps at most three, oldest out first,
 * and moves them to the top on a phone while a sheet is open so they never
 * cover the sheet's footer (GUIDELINE §10).
 */

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast as sonner } from "sonner";

export const MAX_TOASTS = 3;
/** Long enough to reach Undo; hovering pauses it (sonner). */
export const UNDO_TOAST_MS = 6000;
const PHONE_QUERY = "(max-width: 767px)";

type ToastId = string | number;

/** The visible toasts in order. Adding a fourth returns the oldest to dismiss. */
export class ToastQueue {
	private ids: ToastId[] = [];

	constructor(private readonly max = MAX_TOASTS) {}

	add(id: ToastId): ToastId[] {
		this.ids = [...this.ids.filter((x) => x !== id), id];
		const over = this.ids.length - this.max;
		if (over <= 0) return [];
		const dropped = this.ids.slice(0, over);
		this.ids = this.ids.slice(over);
		return dropped;
	}

	remove(id: ToastId): void {
		this.ids = this.ids.filter((x) => x !== id);
	}

	get size(): number {
		return this.ids.length;
	}
}

let openSheets = 0;

/** Sheets call this while open; the returned function releases it once. */
export function trackOpenSheet(): () => void {
	openSheets += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		openSheets -= 1;
	};
}

export function openSheetCount(): number {
	return openSheets;
}

/** Top on a phone while a sheet is open; otherwise the Toaster's default. */
export function toastPosition(
	phone: boolean,
	sheetsOpen: number,
): "top-center" | undefined {
	return phone && sheetsOpen > 0 ? "top-center" : undefined;
}

function isPhone(): boolean {
	return (
		typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches
	);
}

export type ToastCopy = { undo: string; undone: string; undoFailed: string };

export type ToastOptions = {
	/** Reverts the action: usually the inverse mutation. May return a promise. */
	undo?: () => unknown;
	kind?: "success" | "error" | "info";
};

/**
 * Runs undo once (a second click while it runs does nothing), then says
 * "Undone" or "Couldn't undo".
 */
export function undoRunner(
	undo: () => unknown,
	report: (ok: boolean) => void,
): () => Promise<void> {
	let running = false;
	return async () => {
		if (running) return;
		running = true;
		try {
			await undo();
			report(true);
		} catch {
			report(false);
		}
	};
}

const queue = new ToastQueue();

/** Shows one toast; returns its id. Prefer useToast() in components. */
export function showToast(
	message: string,
	copy: ToastCopy,
	options: ToastOptions = {},
): ToastId {
	const kind = options.kind ?? "success";
	const run = options.undo
		? undoRunner(options.undo, (ok) =>
				ok
					? showToast(copy.undone, copy)
					: showToast(copy.undoFailed, copy, { kind: "error" }),
			)
		: null;
	const id = sonner[kind](message, {
		// Toasts sit above sheets; a modal sheet makes the page inert, so the
		// toast takes pointer events back for its Undo button.
		className: "pointer-events-auto",
		duration: run ? UNDO_TOAST_MS : undefined,
		position: toastPosition(isPhone(), openSheets),
		action: run ? { label: copy.undo, onClick: () => void run() } : undefined,
		onDismiss: (t) => queue.remove(t.id),
		onAutoClose: (t) => queue.remove(t.id),
	});
	for (const old of queue.add(id)) sonner.dismiss(old);
	return id;
}

/**
 * `saved("Expense added", { undo: () => restore.mutateAsync(...) })` after a
 * money mutation; `failed("Couldn't save the expense")` on error.
 */
export function useToast() {
	const t = useTranslations("overlays.toast");
	return useMemo(() => {
		const copy: ToastCopy = {
			undo: t("undo"),
			undone: t("undone"),
			undoFailed: t("undoFailed"),
		};
		return {
			saved: (message: string, options?: Omit<ToastOptions, "kind">) =>
				showToast(message, copy, { ...options, kind: "success" }),
			info: (message: string) => showToast(message, copy, { kind: "info" }),
			failed: (message: string) => showToast(message, copy, { kind: "error" }),
		};
	}, [t]);
}
