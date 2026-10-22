/**
 * The Sheet's behavior as plain functions, so it is tested without a DOM:
 * which key submits, when Save is ignored, where focus returns and how the
 * phone detent follows the grabber. ui/sheet.tsx wires these to React.
 */

export type SheetDetent = "medium" | "large";

/** A sheet submit may return false to stay open (a validation error). */
// biome-ignore lint/suspicious/noConfusingVoidType: a submit that returns nothing closes the sheet
export type SheetSubmitResult = boolean | undefined | void;

type KeyLike = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	isComposing?: boolean;
};

/**
 * Enter submits a one-field sheet, Cmd or Ctrl+Enter submits any sheet
 * (GUIDELINE §10). `fieldCount` counts the text fields of this sheet only,
 * and `inThisSheet` is false for a key that bubbled up from a nested sheet
 * (React events follow the component tree through portals).
 */
export function sheetKeySubmits(
	e: KeyLike,
	ctx: { inThisSheet: boolean; targetIsTextField: boolean; fieldCount: number },
): boolean {
	if (e.key !== "Enter" || e.isComposing || !ctx.inThisSheet) return false;
	if (e.metaKey || e.ctrlKey) return true;
	return ctx.targetIsTextField && ctx.fieldCount === 1;
}

/** Text fields that count for "one-field sheet" (not checkboxes, radios or buttons). */
export const SHEET_TEXT_FIELDS =
	"input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit]), select, textarea";

/** Enter in a textarea makes a new line unless Cmd or Ctrl is held. */
export function isSingleLineField(el: {
	tagName?: string;
	type?: string;
}): boolean {
	const tag = (el.tagName ?? "").toLowerCase();
	if (tag !== "input") return false;
	return !["checkbox", "radio", "button", "submit", "hidden"].includes(
		el.type ?? "text",
	);
}

/**
 * One submit at a time, and none once the sheet is closing: a second Enter
 * or a click on Save during the close animation does not save twice.
 */
export class SubmitGuard {
	private busy = false;
	private closing = false;

	get blocked(): boolean {
		return this.busy || this.closing;
	}

	/** Called when the sheet opens again. */
	reset(): void {
		this.busy = false;
		this.closing = false;
	}

	markClosing(): void {
		this.closing = true;
	}

	/**
	 * Runs the submit. Closes unless it returned false or threw; a throw
	 * keeps the sheet open so the caller's error toast has its context.
	 */
	async run(
		submit: () => SheetSubmitResult | Promise<SheetSubmitResult>,
		close: () => void,
		onBusy?: (busy: boolean) => void,
	): Promise<void> {
		if (this.blocked) return;
		this.busy = true;
		onBusy?.(true);
		try {
			const result = await submit();
			if (result !== false) {
				this.closing = true;
				close();
			}
		} finally {
			this.busy = false;
			onBusy?.(false);
		}
	}
}

type Focusable = { isConnected: boolean; focus: (o?: FocusOptions) => void };

/**
 * Radix returns focus only to a Dialog.Trigger, and our sheets open from
 * menus, rows and shortcuts. The sheet remembers what had focus when it
 * opened and returns there, if that element is still on the page.
 */
export function returnFocus(opener: Focusable | null | undefined): boolean {
	if (!opener?.isConnected) return false;
	opener.focus({ preventScroll: true });
	return true;
}

/** Pixels the grabber must travel before the detent changes. */
export const DETENT_DRAG = { up: 48, down: 96 } as const;

/**
 * The grabber: drag up to grow a medium sheet to large, drag down to shrink
 * a large sheet to medium, or to close a medium one. `dy` is positive down.
 */
export function nextDetent(
	current: SheetDetent,
	dy: number,
): SheetDetent | "close" {
	if (dy <= -DETENT_DRAG.up) return "large";
	if (dy >= DETENT_DRAG.down) return current === "large" ? "medium" : "close";
	return current;
}

/**
 * Clicks on a toast (Undo) land outside the sheet. They must not dismiss
 * it, since toasts render above sheets on purpose.
 */
export function isToastTarget(
	target: { closest?: (selector: string) => unknown } | null,
): boolean {
	return Boolean(target?.closest?.("[data-sonner-toaster]"));
}
