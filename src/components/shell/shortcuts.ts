import { ADD_ACTIONS, type AddId } from "~/lib/nav";

/** The parts of a KeyboardEvent the shell's shortcuts read. */
export type ShortcutKey = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
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

/**
 * Typing in a field, or working inside an open dialog or menu, never fires a
 * single-key shortcut: N typed into a note stays an N.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as TargetLike | null;
	if (!el || typeof el !== "object") return false;
	const tag = el.tagName?.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if (el.isContentEditable) return true;
	return Boolean(
		el.closest?.('[role="dialog"], [role="menu"], [role="listbox"]'),
	);
}

/**
 * What a key press does in the shell: Cmd or Ctrl+K opens the palette
 * anywhere; N, I and T add (PLAN §14) and ? lists the keys, but only outside
 * fields and layers and without a modifier.
 */
export function shellShortcut(e: ShortcutKey): ShellShortcut | null {
	if (e.defaultPrevented) return null;
	const key = e.key.toLowerCase();
	if (key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey)
		return { kind: "palette" };
	if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target))
		return null;
	if (e.key === "?") return { kind: "shortcuts" };
	const add = ADD_ACTIONS.find((a) => a.key === key);
	return add ? { kind: "add", id: add.id } : null;
}
