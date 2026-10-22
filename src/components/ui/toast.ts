"use client";

/**
 * Toast: confirms a finished action and offers Undo (R15). Sonner is the
 * engine (the one Toaster is mounted in the root layout); this module is the
 * only way new code shows a toast. It keeps at most three, oldest out first,
 * and moves them to the top on a phone while a sheet is open so they never
 * cover the sheet's footer (GUIDELINE §10). A modal sheet hides the rest of
 * the page from screen readers, so an error toast shown while one is open
 * is also announced inside the top sheet (useSheetAlert).
 */

import { useTranslations } from "next-intl";
import { useMemo, useSyncExternalStore } from "react";
import { toast as sonner } from "sonner";

export const MAX_TOASTS = 3;
/** Long enough to reach Undo; hovering pauses it (sonner). */
export const UNDO_TOAST_MS = 6000;
const PHONE_QUERY = "(max-width: 767px)";

type ToastId = string | number;
type Kind = "success" | "error" | "info";

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

/** Top on a phone while a sheet is open; otherwise the Toaster's default. */
export function toastPosition(
	phone: boolean,
	sheetsOpen: number,
): "top-center" | undefined {
	return phone && sheetsOpen > 0 ? "top-center" : undefined;
}

// ---- open sheets (a small external store) ----------------------------------

const sheets: number[] = [];
let nextSheet = 1;
let alert: { sheet: number; message: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const l of listeners) l();
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/**
 * Sheets call this while open. Returns the sheet's id and a release that
 * runs once. Toasts already showing move when the count changes.
 */
export function trackOpenSheet(): { id: number; release: () => void } {
	const id = nextSheet++;
	sheets.push(id);
	emit();
	let released = false;
	return {
		id,
		release: () => {
			if (released) return;
			released = true;
			sheets.splice(sheets.indexOf(id), 1);
			if (alert?.sheet === id) alert = null;
			emit();
		},
	};
}

/** The error to announce inside this sheet (an error toast shown while it is on top). */
export function sheetAlertFor(sheet: number | null): string | null {
	return alert && alert.sheet === sheet ? alert.message : null;
}

export function useSheetAlert(sheet: number | null): string | null {
	return useSyncExternalStore(
		subscribe,
		() => sheetAlertFor(sheet),
		() => null,
	);
}

export function clearSheetAlert(sheet: number | null): void {
	if (alert?.sheet !== sheet) return;
	alert = null;
	emit();
}

// ---- toasts ----------------------------------------------------------------

function isPhone(): boolean {
	return (
		typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches
	);
}

export type ToastCopy = { undo: string; undone: string; undoFailed: string };

export type ToastOptions = {
	/** Reverts the action: usually the inverse mutation. May return a promise. */
	undo?: () => unknown;
	kind?: Kind;
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

type Shown = { kind: Kind; message: string; data: Record<string, unknown> };
const queue = new ToastQueue();
const shown = new Map<ToastId, Shown>();
let lastPosition = toastPosition(false, 0);

const forget = (t: { id: ToastId }) => {
	queue.remove(t.id);
	shown.delete(t.id);
};

/** Re-emits the visible toasts at the position the open sheets ask for. */
function reposition() {
	const position = toastPosition(isPhone(), sheets.length);
	if (position === lastPosition) return;
	lastPosition = position;
	for (const [id, s] of shown)
		sonner[s.kind](s.message, { ...s.data, id, position });
}
listeners.add(reposition);

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
	const data = {
		// Toasts sit above sheets; a modal sheet makes the page inert, so the
		// toast takes pointer events back for its Undo button.
		className: "pointer-events-auto",
		duration: run ? UNDO_TOAST_MS : undefined,
		action: run ? { label: copy.undo, onClick: () => void run() } : undefined,
		onDismiss: forget,
		onAutoClose: forget,
	};
	lastPosition = toastPosition(isPhone(), sheets.length);
	const id = sonner[kind](message, { ...data, position: lastPosition });
	shown.set(id, { kind, message, data });
	for (const old of queue.add(id)) {
		shown.delete(old);
		sonner.dismiss(old);
	}
	const top = sheets.at(-1);
	if (kind === "error" && top !== undefined) {
		alert = { sheet: top, message };
		emit();
	}
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
