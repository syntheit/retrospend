// @vitest-environment jsdom
// The whole enable sheet in jsdom (vitest's own environment; no extra
// library): the real Sheet, steps and effects, driven through the DOM. This is
// where the wipe paths are proven, because each exit has to call `discard`:
// close, unmount, Back from the methods, and a makeKeys answer that arrives
// after the sheet is gone.
import { loadCatalog } from "@retrospend/i18n/load";
import protection from "@retrospend/i18n/messages/en/protection.json";
import { NextIntlClientProvider } from "next-intl";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { EnableFailure } from "./enable-model";
import { EnableSheet, type EnableSheetProps } from "./enable-sheet";
import type { KeyActions } from "./recovery-key-actions";

const shown = vi.hoisted(() => ({
	success: [] as string[],
	error: [] as string[],
}));
vi.mock("sonner", () => ({
	toast: {
		success: (m: string) => shown.success.push(m),
		error: (m: string) => shown.error.push(m),
		dismiss: () => {},
	},
	Toaster: () => null,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const messages = await loadCatalog("en");
const p = protection;
const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const GROUPS = KEY.split("-");

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
	window.matchMedia = ((q: string) => ({
		matches: false,
		media: q,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		onchange: null,
		dispatchEvent: () => false,
	})) as never;
	shown.success.length = 0;
	shown.error.length = 0;
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	root = null;
	host.remove();
	document.body.innerHTML = "";
});

type Calls = {
	discard: Mock<EnableSheetProps["discard"]>;
	onOpenChange: Mock<EnableSheetProps["onOpenChange"]>;
	onDone: Mock<() => void>;
	makeKeys: Mock<EnableSheetProps["makeKeys"]>;
	save: Mock<EnableSheetProps["save"]>;
	copy: Mock<KeyActions["copy"]>;
};

function props(
	over: Partial<EnableSheetProps> = {},
): [EnableSheetProps, Calls] {
	const copy = vi.fn<KeyActions["copy"]>(async () => {});
	const actions: KeyActions = { copy, download: vi.fn(), print: vi.fn() };
	const calls: Calls = {
		discard: vi.fn<EnableSheetProps["discard"]>(),
		onOpenChange: vi.fn<EnableSheetProps["onOpenChange"]>(),
		onDone: vi.fn<() => void>(),
		makeKeys: vi.fn<EnableSheetProps["makeKeys"]>(async () => KEY),
		save: vi.fn<EnableSheetProps["save"]>(async () => {}),
		copy,
	};
	return [
		{
			open: true,
			onOpenChange: calls.onOpenChange,
			twoFactor: false,
			account: "ana@example.com",
			made: new Date(2026, 10, 18),
			makeKeys: calls.makeKeys,
			save: calls.save,
			discard: calls.discard,
			onDone: calls.onDone,
			actions,
			random: () => 0,
			...over,
		},
		calls,
	];
}

const view = (p: EnableSheetProps) =>
	h(NextIntlClientProvider, {
		locale: "en",
		messages,
		timeZone: "UTC",
		children: h(EnableSheet, p),
	});
const render = (p: EnableSheetProps) => act(async () => root?.render(view(p)));

const text = () => document.body.textContent ?? "";
const button = (label: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label,
	);
	if (!found) throw new Error(`no button ${label}`);
	return found;
};
const field = (label: string) => {
	const l = [...document.body.querySelectorAll("label")].find(
		(x) => x.textContent?.trim() === label,
	);
	const input = l && document.getElementById(l.htmlFor);
	if (!(input instanceof HTMLInputElement))
		throw new Error(`no field ${label}`);
	return input;
};
const click = (el: Element) =>
	act(async () => {
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
const type = (el: HTMLInputElement, value: string) =>
	act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	});
const flush = () => act(async () => {});

const NEW = "New password";
const CONFIRM = "Confirm new password";
async function toMethods() {
	await click(button(p.enable.what.continue));
	await type(field(NEW), "Abcdef12");
	await type(field(CONFIRM), "Abcdef12");
	await click(button(p.enable.newPassword.continue));
	await flush();
}
async function toConfirmYou() {
	await toMethods();
	await click(button(p.methods.createKey));
	await click(button(p.recoveryKey.saved));
	const asked = text().match(/Type group (\d+) and group (\d+)/);
	for (const n of [Number(asked?.[1]), Number(asked?.[2])])
		await type(field(`Group ${n}`), GROUPS[n - 1] ?? "");
	await click(button(p.enable.methods.continue));
	await click(button(p.enable.methods.continue));
}

describe("the way through", () => {
	it("makes the keys, saves them and ends on the notice", async () => {
		const [pr, calls] = props({ twoFactor: true });
		await render(pr);
		await toConfirmYou();
		await type(field("Password"), "current");
		// The six code digits go in through the one-time field.
		const code =
			document.body.querySelector<HTMLInputElement>("[data-input-otp]");
		if (!code) throw new Error("no code field");
		await type(code, "123456");
		await click(button(p.enable.confirmYou.continue));
		await flush();
		expect(calls.makeKeys).toHaveBeenCalledWith("Abcdef12");
		expect(calls.save).toHaveBeenCalledWith({
			password: "current",
			code: "123456",
		});
		expect(text()).toContain(p.enable.notice);
		await click(button(p.methods.done));
		expect(calls.onDone).toHaveBeenCalledTimes(1);
		expect(calls.onOpenChange).toHaveBeenCalledWith(false);
	});

	it("says it is making the keys, and ignores Close and Back meanwhile", async () => {
		let release: (k: string) => void = () => {};
		const [pr, calls] = props({
			makeKeys: () => new Promise<string>((r) => (release = r)),
		});
		await render(pr);
		await click(button(p.enable.what.continue));
		await type(field(NEW), "Abcdef12");
		await type(field(CONFIRM), "Abcdef12");
		await click(button(p.enable.newPassword.continue));
		expect(text()).toContain(p.enable.making);
		expect(button(p.enable.back).disabled).toBe(true);
		const close = document.body.querySelector('[aria-label="Close"]');
		if (!close) throw new Error("no close button");
		await click(close);
		expect(calls.onOpenChange).not.toHaveBeenCalled();
		await act(async () => release(KEY));
		expect(text()).toContain(p.methods.createKey);
	});

	it("asks only once for a double press on Continue", async () => {
		const makeKeys = vi.fn<EnableSheetProps["makeKeys"]>(
			() => new Promise<string>(() => {}),
		);
		const [pr] = props({ makeKeys });
		await render(pr);
		await click(button(p.enable.what.continue));
		await type(field(NEW), "Abcdef12");
		await type(field(CONFIRM), "Abcdef12");
		const go = button(p.enable.newPassword.continue);
		await act(async () => {
			go.click();
			go.click();
		});
		expect(makeKeys).toHaveBeenCalledTimes(1);
	});
});

describe("wiping the draft", () => {
	it("does nothing while the sheet stays open", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		expect(calls.discard).not.toHaveBeenCalled();
	});

	it("wipes when the sheet closes, and starts again from the first step", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		await render({ ...pr, open: false });
		expect(calls.discard).toHaveBeenCalledTimes(1);
		await render({ ...pr, open: true });
		expect(text()).toContain(p.enable.what.title);
		expect(text()).not.toContain(p.methods.createKey);
	});

	it("wipes when the sheet unmounts while open", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		expect(calls.discard).not.toHaveBeenCalled();
		await act(async () => root?.unmount());
		root = null;
		expect(calls.discard).toHaveBeenCalledTimes(1);
	});

	it("wipes on Back from the methods to the password", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		await click(button(p.enable.back));
		expect(calls.discard).toHaveBeenCalledTimes(1);
		expect(text()).toContain(p.enable.newPassword.title);
	});

	it("does not wipe on Back from the key steps to the methods", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		await click(button(p.methods.createKey));
		await click(button(p.enable.back));
		expect(calls.discard).not.toHaveBeenCalled();
	});

	it("wipes a draft that arrives after the sheet closed", async () => {
		let release: (k: string) => void = () => {};
		const [pr, calls] = props({
			makeKeys: () => new Promise<string>((r) => (release = r)),
		});
		await render(pr);
		await click(button(p.enable.what.continue));
		await type(field(NEW), "Abcdef12");
		await type(field(CONFIRM), "Abcdef12");
		await click(button(p.enable.newPassword.continue));
		await render({ ...pr, open: false });
		expect(calls.discard).toHaveBeenCalledTimes(1);
		await act(async () => release(KEY));
		expect(calls.discard).toHaveBeenCalledTimes(2);
	});

	it("wipes a draft that arrives after the sheet unmounted", async () => {
		let release: (k: string) => void = () => {};
		const [pr, calls] = props({
			makeKeys: () => new Promise<string>((r) => (release = r)),
		});
		await render(pr);
		await click(button(p.enable.what.continue));
		await type(field(NEW), "Abcdef12");
		await type(field(CONFIRM), "Abcdef12");
		await click(button(p.enable.newPassword.continue));
		await act(async () => root?.unmount());
		root = null;
		expect(calls.discard).toHaveBeenCalledTimes(1);
		await act(async () => release(KEY));
		expect(calls.discard).toHaveBeenCalledTimes(2);
	});

	it("keeps a draft that arrives while the sheet is open", async () => {
		const [pr, calls] = props();
		await render(pr);
		await toMethods();
		expect(text()).toContain(p.methods.createKey);
		expect(calls.discard).not.toHaveBeenCalled();
	});
});

describe("a final failure", () => {
	it("stays through typing and offers only Close", async () => {
		const save = vi.fn(async () => {
			throw new EnableFailure("checkFailed");
		});
		const [pr] = props({ save });
		await render(pr);
		await toConfirmYou();
		await type(field("Password"), "current");
		await click(button(p.enable.confirmYou.continue));
		await flush();
		expect(text()).toContain(p.errors.checkFailed);
		const input = field("Password");
		expect(input.disabled).toBe(true);
		await type(input, "changed");
		expect(field("Password").value).toBe("current");
		expect(text()).toContain(p.errors.checkFailed);
		expect(
			[...document.body.querySelectorAll("button")].some(
				(b) => b.textContent?.trim() === p.enable.confirmYou.continue,
			),
		).toBe(false);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("lets a wrong password be retyped and sent again", async () => {
		const save = vi
			.fn<EnableSheetProps["save"]>()
			.mockRejectedValueOnce(new EnableFailure("wrongPassword"))
			.mockResolvedValueOnce(undefined);
		const [pr] = props({ save });
		await render(pr);
		await toConfirmYou();
		await type(field("Password"), "nope");
		await click(button(p.enable.confirmYou.continue));
		await flush();
		expect(text()).toContain(p.errors.wrongPassword);
		await type(field("Password"), "right");
		expect(text()).not.toContain(p.errors.wrongPassword);
		await click(button(p.enable.confirmYou.continue));
		await flush();
		expect(text()).toContain(p.enable.notice);
	});
});

describe("copying the key", () => {
	async function toSaveKey(pr: EnableSheetProps) {
		await render(pr);
		await toMethods();
		await click(button(p.methods.createKey));
	}

	it("says Copied after the clipboard took it", async () => {
		const [pr, calls] = props();
		await toSaveKey(pr);
		await click(button(p.recoveryKey.copy));
		await flush();
		expect(calls.copy).toHaveBeenCalledWith(KEY);
		expect(shown.success).toEqual([p.recoveryKey.copied]);
		expect(text()).not.toContain(p.errors.failed);
	});

	it("says it failed, and never Copied, when the clipboard refuses", async () => {
		const [pr, calls] = props();
		calls.copy.mockRejectedValueOnce(new Error("denied"));
		await toSaveKey(pr);
		await click(button(p.recoveryKey.copy));
		await flush();
		expect(shown.success).toEqual([]);
		expect(text()).toContain(p.errors.failed);
		// A second try that works clears the line.
		await click(button(p.recoveryKey.copy));
		await flush();
		expect(shown.success).toEqual([p.recoveryKey.copied]);
		expect(text()).not.toContain(p.errors.failed);
	});
});
