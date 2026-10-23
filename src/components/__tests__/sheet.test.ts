import { describe, expect, it, vi } from "vitest";
import {
	DETENT_SNAP,
	detentOf,
	isSingleLineField,
	isToastTarget,
	keyboardInset,
	menuTriggerOf,
	returnFocus,
	SNAP_POINTS,
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
		expect(await g.run(() => undefined, close)).toEqual({ status: "closed" });
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("stays open when submit returns false", async () => {
		const g = new SubmitGuard();
		const close = vi.fn();
		expect(await g.run(() => false, close)).toEqual({ status: "stayed" });
		expect(close).not.toHaveBeenCalled();
	});

	it("a throw is reported, not rejected, and keeps the sheet open", async () => {
		const g = new SubmitGuard();
		const close = vi.fn();
		const boom = new Error("server said no");
		const out = await g.run(() => Promise.reject(boom), close);
		expect(out).toEqual({ status: "failed", error: boom });
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
		expect(await g.run(submit, close)).toEqual({ status: "ignored" });
		finish();
		await first;
		expect(submit).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("Esc or Cancel while saving waits, so a false result is not dropped", async () => {
		const g = new SubmitGuard();
		let finish: (v: boolean) => void = () => {};
		const run = g.run(
			() => new Promise<boolean>((r) => (finish = r)),
			() => {},
		);
		expect(g.canClose).toBe(false);
		finish(false);
		expect(await run).toEqual({ status: "stayed" });
		expect(g.canClose).toBe(true);
	});

	it("a closed sheet ignores Save until it opens again", async () => {
		const g = new SubmitGuard();
		const submit = vi.fn();
		g.syncOpen(false);
		expect(await g.run(submit, () => {})).toEqual({ status: "ignored" });
		g.syncOpen(true);
		await g.run(submit, () => {});
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("a parent that keeps the sheet open after Save lifts the closing state", async () => {
		const g = new SubmitGuard();
		await g.run(
			() => undefined,
			() => {},
		);
		expect(g.blocked).toBe(true);
		g.syncOpen(true);
		expect(g.blocked).toBe(false);
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

const el = (connected = true) => ({ isConnected: connected, focus: vi.fn() });

describe("Sheet focus return", () => {
	it("returns focus to the opener while it is on the page", () => {
		const opener = el();
		expect(returnFocus(opener)).toBe(true);
		expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("returnFocusTo wins over the opener", () => {
		const explicit = el();
		const opener = el();
		returnFocus(explicit, opener);
		expect(explicit.focus).toHaveBeenCalled();
		expect(opener.focus).not.toHaveBeenCalled();
	});

	it("a menu item that unmounted falls back to its menu's trigger", () => {
		const trigger = el();
		const item = {
			...el(false),
			closest: (s: string) =>
				s === '[role="menu"]' ? { id: "radix-7" } : null,
		};
		const lookup = vi.fn((sel: string) =>
			sel === '[aria-controls="radix-7"]' ? trigger : null,
		);
		const fallback = menuTriggerOf(item, lookup);
		expect(fallback).toBe(trigger);
		returnFocus(undefined, item, fallback);
		expect(item.focus).not.toHaveBeenCalled();
		expect(trigger.focus).toHaveBeenCalled();
	});

	it("an opener outside a menu has no fallback; nothing on the page, no focus", () => {
		expect(menuTriggerOf({ closest: () => null }, () => el())).toBeNull();
		expect(menuTriggerOf(null, () => el())).toBeNull();
		expect(returnFocus(null, el(false), undefined)).toBe(false);
	});
});

describe("Sheet detents (phone)", () => {
	it("medium and large are the kit's 52% and 94% snap points", () => {
		expect(SNAP_POINTS).toEqual([0.52, 0.94]);
		expect(DETENT_SNAP.medium).toBe(0.52);
		expect(detentOf(0.52)).toBe("medium");
		expect(detentOf(0.94)).toBe("large");
		expect(detentOf(null)).toBe("large");
	});
});

describe("Sheet and the phone keyboard", () => {
	const vv = (height: number, offsetTop = 0, scale = 1) => ({
		height,
		offsetTop,
		scale,
	});

	it("is the part of the screen below the visual viewport", () => {
		// 844 tall, a 336px keyboard leaves 508 visible.
		expect(keyboardInset(844, vv(508))).toBe(336);
		// iOS pans the page up 100px: the visible part ends at 608.
		expect(keyboardInset(844, vv(508, 100))).toBe(236);
	});

	it("ignores toolbar changes, pinch zoom and a missing visual viewport", () => {
		expect(keyboardInset(844, vv(844))).toBe(0);
		expect(keyboardInset(844, vv(800))).toBe(0);
		expect(keyboardInset(844, vv(422, 0, 2))).toBe(0);
		expect(keyboardInset(844, vv(900))).toBe(0);
		expect(keyboardInset(844, null)).toBe(0);
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
