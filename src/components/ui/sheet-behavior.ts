/**
 * The Sheet's behavior as plain functions, so it is tested without a DOM:
 * which key submits, when Save is ignored, where focus returns and which
 * snap point each detent uses. ui/sheet.tsx wires these to React.
 */

export type SheetDetent = "medium" | "large";

/** A sheet submit may return false to stay open (a validation error). */
// biome-ignore lint/suspicious/noConfusingVoidType: a submit that returns nothing closes the sheet
export type SheetSubmitResult = boolean | undefined | void;

/** Phone detents as vaul snap points: the kit's 52% and 94% sheet heights. */
export const DETENT_SNAP: Record<SheetDetent, number> = {
	medium: 0.52,
	large: 0.94,
};
export const SNAP_POINTS = [DETENT_SNAP.medium, DETENT_SNAP.large];

export function detentOf(snap: number | string | null): SheetDetent {
	return snap === DETENT_SNAP.medium ? "medium" : "large";
}

/** Under this, a visual viewport change is a browser toolbar, not a keyboard. */
const KEYBOARD_MIN_PX = 80;

/**
 * How much of the screen the on-screen keyboard covers, in px. The keyboard
 * shrinks the visual viewport but not window.innerHeight (iOS Safari, and
 * Chrome's default resizes-visual), and iOS may pan the page up as well, so
 * this is the part of the layout viewport below the visible area. Pinch zoom
 * also shrinks the visual viewport and counts as no keyboard.
 */
export function keyboardInset(
	innerHeight: number,
	vv: { height: number; offsetTop: number; scale: number } | null | undefined,
): number {
	if (!vv || Math.abs(vv.scale - 1) > 0.01) return 0;
	const covered = Math.round(innerHeight - vv.offsetTop - vv.height);
	return covered >= KEYBOARD_MIN_PX ? covered : 0;
}

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

export type SubmitOutcome =
	| { status: "closed" }
	| { status: "stayed" }
	| { status: "failed"; error: unknown }
	| { status: "ignored" };

/**
 * One submit at a time, none while the sheet is closing, and no close while
 * a submit runs (Esc or Cancel then would drop a validation result).
 * Closing starts when a submit succeeds and is confirmed by the open prop:
 * a parent that keeps the sheet open (unsaved changes) lifts it again.
 */
export class SubmitGuard {
	private busy = false;
	private closing = false;

	get blocked(): boolean {
		return this.busy || this.closing;
	}

	/** Esc, Cancel, the scrim and the close button ask first. */
	get canClose(): boolean {
		return !this.busy;
	}

	/** Called on every render with the open prop. */
	syncOpen(open: boolean): void {
		if (open && !this.busy) this.closing = false;
		if (!open) this.closing = true;
	}

	/** Runs the submit; a throw keeps the sheet open and reports it. */
	async run(
		submit: () => SheetSubmitResult | Promise<SheetSubmitResult>,
		close: () => void,
		onBusy?: (busy: boolean) => void,
	): Promise<SubmitOutcome> {
		if (this.blocked) return { status: "ignored" };
		this.busy = true;
		onBusy?.(true);
		let result: SheetSubmitResult;
		try {
			result = await submit();
		} catch (error) {
			return { status: "failed", error };
		} finally {
			this.busy = false;
			onBusy?.(false);
		}
		if (result === false) return { status: "stayed" };
		this.closing = true;
		close();
		return { status: "closed" };
	}
}

type Focusable = { isConnected: boolean; focus: (o?: FocusOptions) => void };

/**
 * Radix returns focus only to a Dialog.Trigger, and our sheets open from
 * menus, rows and shortcuts. Focus goes to the first of these still on the
 * page: the caller's returnFocusTo, the element that had focus when the
 * sheet opened, then the trigger of the menu it was in (a menu item
 * unmounts when its menu closes).
 */
export function returnFocus(
	...candidates: (Focusable | null | undefined)[]
): boolean {
	const target = candidates.find((c) => c?.isConnected);
	if (!target) return false;
	target.focus({ preventScroll: true });
	return true;
}

/**
 * Where focus lands when a sheet opens: the first field, else the verb, else
 * the sheet itself (Radix content takes focus, tabIndex -1). Never Close: its
 * tooltip opens on focus and then takes the first Escape.
 */
export function initialFocus<T extends Focusable>(
	field: T | null | undefined,
	submit: T | null | undefined,
	root: T | null | undefined,
): T | null {
	return field ?? submit ?? root ?? null;
}

type MenuLike = { id?: string } | null;
type Lookup = (selector: string) => Focusable | null;

/** The button that opened the menu an element sits in (Radix sets aria-controls). */
export function menuTriggerOf(
	el: { closest?: (s: string) => MenuLike } | null,
	lookup: Lookup,
): Focusable | null {
	const menu = el?.closest?.('[role="menu"]');
	if (!menu?.id) return null;
	return lookup(`[aria-controls="${menu.id}"]`);
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
