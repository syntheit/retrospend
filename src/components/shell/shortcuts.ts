import { ADD_ACTIONS, type AddId } from "~/lib/nav";

/** The parts of a KeyboardEvent the shell's shortcuts read. */
export type ShortcutKey = {
	key: string;
	/** Physical key, for layouts whose letters are not Latin (KeyN on a Cyrillic N). */
	code?: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	isComposing?: boolean;
	target: EventTarget | null;
	defaultPrevented?: boolean;
};

export type ShellShortcut =
	| { kind: "add"; id: AddId }
	| { kind: "palette" }
	| { kind: "shortcuts" };

type TargetLike = {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
};

/** Layers and widgets that own their keys while they are open or focused. */
export const KEY_OWNERS =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]';

/**
 * Typing in a field, or working inside an open dialog, menu or combobox,
 * never fires a single-key shortcut: N typed into a note stays an N.
 */
export function isTypingTarget(
	target: EventTarget | null | undefined,
): boolean {
	const el = target as TargetLike | null | undefined;
	if (!el || typeof el !== "object") return false;
	const tag = el.tagName?.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if (el.isContentEditable) return true;
	return Boolean(el.closest?.(KEY_OWNERS));
}

/** The letter a key press means: the typed key, else the physical key. */
function letterOf(e: ShortcutKey): string {
	const key = e.key.toLowerCase();
	if (/^[a-z]$/.test(key)) return key;
	const code = /^Key([A-Z])$/.exec(e.code ?? "");
	return code?.[1]?.toLowerCase() ?? key;
}

/**
 * What a key press does in the shell: Cmd or Ctrl+K toggles the palette
 * anywhere; N, I and T add (PLAN §14) and ? lists the keys, but only
 * outside fields and layers and without a modifier. `focused` is the
 * document's active element: a page search that grabs focus from its own
 * document listener must keep the rest of the word ("taxi" is not Transfer).
 */
export function shellShortcut(
	e: ShortcutKey,
	focused?: EventTarget | null,
): ShellShortcut | null {
	if (!e.key || e.isComposing || e.defaultPrevented) return null;
	const letter = letterOf(e);
	if (letter === "k" && (e.metaKey || e.ctrlKey) && !e.altKey)
		return { kind: "palette" };
	if (e.metaKey || e.ctrlKey || e.altKey) return null;
	if (isTypingTarget(e.target) || isTypingTarget(focused)) return null;
	if (e.key === "?") return { kind: "shortcuts" };
	const add = ADD_ACTIONS.find((a) => a.key === letter);
	return add ? { kind: "add", id: add.id } : null;
}
