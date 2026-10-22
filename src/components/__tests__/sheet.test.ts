import { describe, expect, it, vi } from "vitest";
import {
	DETENT_DRAG,
	isSingleLineField,
	isToastTarget,
	nextDetent,
	returnFocus,
	SubmitGuard,
	sheetKeySubmits,
} from "../ui/sheet-behavior";

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean } = {}) => ({
	key: k,
	metaKey: !!mods.meta,
	ctrlKey: !!mods.ctrl,
});
const here = { inThisSheet: true, targetIsTextField: true, fieldCount: 3 };

describe("Sheet keyboard", () => {
	it("Cmd+Enter and Ctrl+Enter submit any sheet", () => {
		expect(sheetKeySubmits(key("Enter", { meta: true }), here)).toBe(true);
		expect(sheetKeySubmits(key("Enter", { ctrl: true }), here)).toBe(true);
		expect(
			sheetKeySubmits(key("Enter", { meta: true }), {
				...here,
				targetIsTextField: false,
			}),
		).toBe(true);
	});

	it("plain Enter submits only a one-field sheet from its text field", () => {
		expect(sheetKeySubmits(key("Enter"), here)).toBe(false);
		expect(sheetKeySubmits(key("Enter"), { ...here, fieldCount: 1 })).toBe(
			true,
		);
		expect(
			sheetKeySubmits(key("Enter"), {
				...here,
				fieldCount: 1,
				targetIsTextField: false,
			}),
		).toBe(false);
	});

	it("ignores other keys, IME composition and keys from a nested sheet", () => {
		expect(sheetKeySubmits(key("a", { meta: true }), here)).toBe(false);
		expect(
			sheetKeySubmits(
				{ ...key("Enter", { meta: true }), isComposing: true },
				here,
			),
		).toBe(false);
		expect(
			sheetKeySubmits(key("Enter", { meta: true }), {
				...here,
				inThisSheet: false,
			}),
		).toBe(false);
	});

	it("a textarea, checkbox or button is not a single-line field", () => {
		expect(isSingleLineField({ tagName: "INPUT", type: "text" })).toBe(true);
		expect(isSingleLineField({ tagName: "INPUT" })).toBe(true);
		expect(isSingleLineField({ tagName: "INPUT", type: "checkbox" })).toBe(
			false,
		);
		expect(isSingleLineField({ tagName: "TEXTAREA" })).toBe(false);
		expect(isSingleLineField({ tagName: "BUTTON" })).toBe(false);
	});
});

describe("Sheet submit guard", () => {
	it("closes after a submit that does not return false", async () => {
		const g = new SubmitGuard();
		const close = vi.fn();
		await g.run(() => undefined, close);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("stays open when submit returns false or throws", async () => {
		const g = new SubmitGuard();
		const close = vi.fn();
		await g.run(() => false, close);
		await expect(
			g.run(() => {
				throw new Error("server said no");
			}, close),
		).rejects.toThrow("server said no");
		expect(close).not.toHaveBeenCalled();
		expect(g.blocked).toBe(false);
	});

	it("a second Enter while saving does not save twice", async () => {
		const g = new SubmitGuard();
		let finish: () => void = () => {};
		const submit = vi.fn(
			() => new Promise<undefined>((r) => (finish = () => r(undefined))),
		);
		const close = vi.fn();
		const first = g.run(submit, close);
		await g.run(submit, close);
		finish();
		await first;
		expect(submit).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("a closing sheet ignores Save until it opens again", async () => {
		const g = new SubmitGuard();
		const submit = vi.fn();
		g.markClosing();
		await g.run(submit, () => {});
		expect(submit).not.toHaveBeenCalled();
		g.reset();
		await g.run(submit, () => {});
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("reports busy while the submit runs", async () => {
		const g = new SubmitGuard();
		const busy: boolean[] = [];
		await g.run(
			() => undefined,
			() => {},
			(b) => busy.push(b),
		);
		expect(busy).toEqual([true, false]);
	});
});

describe("Sheet focus return", () => {
	it("returns focus to the opener while it is on the page", () => {
		const opener = { isConnected: true, focus: vi.fn() };
		expect(returnFocus(opener)).toBe(true);
		expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("does nothing when the opener is gone", () => {
		const gone = { isConnected: false, focus: vi.fn() };
		expect(returnFocus(gone)).toBe(false);
		expect(returnFocus(null)).toBe(false);
		expect(gone.focus).not.toHaveBeenCalled();
	});
});

describe("Sheet detents (phone)", () => {
	it("drag up grows medium to large; a small drag keeps the detent", () => {
		expect(nextDetent("medium", -DETENT_DRAG.up)).toBe("large");
		expect(nextDetent("medium", -10)).toBe("medium");
		expect(nextDetent("large", 40)).toBe("large");
	});

	it("drag down shrinks large to medium, then closes", () => {
		expect(nextDetent("large", DETENT_DRAG.down)).toBe("medium");
		expect(nextDetent("medium", DETENT_DRAG.down)).toBe("close");
	});
});

describe("Sheet and toasts", () => {
	it("a click on a toast does not dismiss the sheet", () => {
		const inToast = {
			closest: (s: string) => (s === "[data-sonner-toaster]" ? {} : null),
		};
		const outside = { closest: () => null };
		expect(isToastTarget(inToast)).toBe(true);
		expect(isToastTarget(outside)).toBe(false);
		expect(isToastTarget(null)).toBe(false);
	});
});
