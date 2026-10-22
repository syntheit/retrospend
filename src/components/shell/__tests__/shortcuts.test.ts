import { describe, expect, it } from "vitest";
import { isTypingTarget, KEY_OWNERS, shellShortcut } from "../shortcuts";

/**
 * A DOM-like element: tag, role, contenteditable and a parent, with a
 * `closest` that honors the attribute selectors the shortcuts pass (a list
 * of [role="x"]), walking up from the element itself like the DOM does.
 */
type FakeEl = {
	tagName: string;
	role?: string;
	isContentEditable: boolean;
	parent?: FakeEl;
	closest: (selector: string) => FakeEl | null;
};

function el(
	tagName: string,
	opts: { role?: string; editable?: boolean; parent?: FakeEl } = {},
): FakeEl {
	const node: FakeEl = {
		tagName,
		role: opts.role,
		isContentEditable: opts.editable ?? opts.parent?.isContentEditable ?? false,
		parent: opts.parent,
		closest(selector) {
			const roles = [...selector.matchAll(/\[role="([^"]+)"\]/g)].map(
				(m) => m[1],
			);
			let at: FakeEl | undefined = node;
			while (at) {
				if (at.role && roles.includes(at.role)) return at;
				at = at.parent;
			}
			return null;
		},
	};
	return node;
}

const body = el("BODY");
const key = (
	k: string,
	extra: Partial<Parameters<typeof shellShortcut>[0]> = {},
) => ({
	key: k,
	code: k.length === 1 ? `Key${k.toUpperCase()}` : undefined,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	target: body as unknown as EventTarget,
	...extra,
});
const on = (target: FakeEl) => target as unknown as EventTarget;

describe("shellShortcut", () => {
	it("maps N, I and T to the Add family, either case", () => {
		expect(shellShortcut(key("n"))).toEqual({ kind: "add", id: "expense" });
		expect(shellShortcut(key("N"))).toEqual({ kind: "add", id: "expense" });
		expect(shellShortcut(key("i"))).toEqual({ kind: "add", id: "income" });
		expect(shellShortcut(key("t"))).toEqual({ kind: "add", id: "transfer" });
	});

	it("reads the physical key on a non-Latin layout", () => {
		// Russian layout: the N key types "т", the T key types "е".
		expect(shellShortcut(key("т", { code: "KeyN" }))).toEqual({
			kind: "add",
			id: "expense",
		});
		expect(shellShortcut(key("е", { code: "KeyT" }))).toEqual({
			kind: "add",
			id: "transfer",
		});
		expect(shellShortcut(key("л", { code: "KeyK", metaKey: true }))).toEqual({
			kind: "palette",
		});
		expect(shellShortcut(key("ж", { code: "Semicolon" }))).toBeNull();
	});

	it("toggles the palette on Cmd or Ctrl+K, even from a field or the palette", () => {
		expect(shellShortcut(key("k", { metaKey: true }))).toEqual({
			kind: "palette",
		});
		const input = el("INPUT", { parent: el("DIV", { role: "dialog" }) });
		expect(
			shellShortcut(
				key("k", { ctrlKey: true, target: on(input) }),
				input as never,
			),
		).toEqual({ kind: "palette" });
	});

	it("lists the keys on ?", () => {
		expect(shellShortcut(key("?", { code: "Slash" }))).toEqual({
			kind: "shortcuts",
		});
	});

	it("ignores keys typed in fields", () => {
		for (const tag of ["INPUT", "TEXTAREA", "SELECT"])
			expect(shellShortcut(key("n", { target: on(el(tag)) }))).toBeNull();
		const editor = el("P", { parent: el("DIV", { editable: true }) });
		expect(shellShortcut(key("n", { target: on(editor) }))).toBeNull();
	});

	it("ignores keys inside open layers and comboboxes", () => {
		for (const role of [
			"dialog",
			"alertdialog",
			"menu",
			"listbox",
			"combobox",
		]) {
			const inside = el("BUTTON", { parent: el("DIV", { role }) });
			expect(shellShortcut(key("t", { target: on(inside) })), role).toBeNull();
		}
		expect(KEY_OWNERS).toContain('[role="alertdialog"]');
		expect(KEY_OWNERS).toContain('[role="combobox"]');
	});

	it("leaves the rest of a word to a search that took focus on its first key", () => {
		// A page's document listener focused its search on "t" of "taxi"; the
		// event target is still the body, but the focused element is the field.
		const search = el("INPUT");
		expect(shellShortcut(key("a"), search as never)).toBeNull();
		expect(shellShortcut(key("t"), search as never)).toBeNull();
		expect(shellShortcut(key("t"), body as never)).toEqual({
			kind: "add",
			id: "transfer",
		});
	});

	it("ignores modifiers, composition, handled and empty keys", () => {
		expect(shellShortcut(key("n", { metaKey: true }))).toBeNull();
		expect(shellShortcut(key("n", { ctrlKey: true }))).toBeNull();
		expect(shellShortcut(key("n", { altKey: true }))).toBeNull();
		expect(shellShortcut(key("n", { isComposing: true }))).toBeNull();
		expect(shellShortcut(key("n", { defaultPrevented: true }))).toBeNull();
		expect(shellShortcut(key(""))).toBeNull();
		expect(shellShortcut(key("x"))).toBeNull();
	});
});

describe("isTypingTarget", () => {
	it("is false for plain elements and nothing", () => {
		expect(isTypingTarget(on(el("BUTTON")))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget(undefined)).toBe(false);
	});
});
