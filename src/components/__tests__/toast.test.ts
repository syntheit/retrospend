import { beforeEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => {
	let next = 0;
	const make = () => vi.fn((_message: string, _options?: unknown) => ++next);
	return {
		success: make(),
		error: make(),
		info: make(),
		dismiss: vi.fn(),
	};
});
vi.mock("sonner", () => ({ toast: sonner }));

let phone = false;
vi.stubGlobal("window", {
	matchMedia: () => ({ matches: phone }),
});

const {
	MAX_TOASTS,
	sheetAlertFor,
	showToast,
	ToastQueue,
	toastPosition,
	trackOpenSheet,
	UNDO_TOAST_MS,
	undoRunner,
} = await import("../ui/toast");

const copy = { undo: "Undo", undone: "Undone", undoFailed: "Couldn't undo" };

type Opts = {
	action?: { label: string; onClick: () => void };
	duration?: number;
	position?: string;
};
const lastOptions = (fn: { mock: { calls: unknown[][] } }) =>
	fn.mock.calls.at(-1)?.[1] as Opts;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ToastQueue", () => {
	it("keeps at most three; the oldest goes first", () => {
		const q = new ToastQueue();
		expect(MAX_TOASTS).toBe(3);
		expect(q.add(1)).toEqual([]);
		expect(q.add(2)).toEqual([]);
		expect(q.add(3)).toEqual([]);
		expect(q.add(4)).toEqual([1]);
		expect(q.size).toBe(3);
	});

	it("a dismissed toast frees its slot", () => {
		const q = new ToastQueue();
		q.add(1);
		q.add(2);
		q.add(3);
		q.remove(2);
		expect(q.add(4)).toEqual([]);
		expect(q.add(5)).toEqual([1]);
	});
});

describe("toast position", () => {
	it("moves to the top on a phone while a sheet is open", () => {
		expect(toastPosition(true, 1)).toBe("top-center");
		expect(toastPosition(true, 0)).toBeUndefined();
		expect(toastPosition(false, 2)).toBeUndefined();
	});

	it("on a phone, a new toast goes to the top while a sheet is open", () => {
		phone = true;
		const sheet = trackOpenSheet();
		showToast("Expense added", copy);
		expect(lastOptions(sonner.success).position).toBe("top-center");
		sheet.release();
		showToast("Expense added", copy);
		expect(lastOptions(sonner.success).position).toBeUndefined();
		phone = false;
	});

	it("toasts already showing move when a sheet opens and when it closes", () => {
		phone = true;
		const id = showToast("Payment recorded", copy);
		vi.clearAllMocks();
		const sheet = trackOpenSheet();
		expect(sonner.success).toHaveBeenCalledWith(
			"Payment recorded",
			expect.objectContaining({ id, position: "top-center" }),
		);
		sheet.release();
		sheet.release();
		expect(sonner.success).toHaveBeenLastCalledWith(
			"Payment recorded",
			expect.objectContaining({ id, position: undefined }),
		);
		// Each visible toast (up to three) moves once per change.
		const moves = sonner.success.mock.calls.filter(
			(c) => (c[1] as { id?: unknown })?.id === id,
		);
		expect(moves).toHaveLength(2);
		phone = false;
	});
});

describe("errors inside a modal sheet", () => {
	it("an error toast is announced in the top sheet only, until it closes", () => {
		const below = trackOpenSheet();
		const top = trackOpenSheet();
		showToast("Couldn't save the expense", copy, { kind: "error" });
		expect(sheetAlertFor(top.id)).toBe("Couldn't save the expense");
		expect(sheetAlertFor(below.id)).toBeNull();
		top.release();
		expect(sheetAlertFor(top.id)).toBeNull();
		below.release();
	});

	it("a success toast is not announced in the sheet", () => {
		const sheet = trackOpenSheet();
		showToast("Expense added", copy);
		expect(sheetAlertFor(sheet.id)).toBeNull();
		sheet.release();
	});
});

describe("undo", () => {
	it("calls the passed mutation once, then reports success", async () => {
		const undo = vi.fn(async () => {});
		const report = vi.fn();
		const run = undoRunner(undo, report);
		await Promise.all([run(), run()]);
		expect(undo).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith(true);
	});

	it("reports failure when the mutation rejects", async () => {
		const report = vi.fn();
		await undoRunner(() => Promise.reject(new Error("x")), report)();
		expect(report).toHaveBeenCalledWith(false);
	});

	it("an undo toast has the Undo action and a longer life", async () => {
		const undo = vi.fn();
		showToast("Expense added", copy, { undo });
		const o = lastOptions(sonner.success);
		expect(o.action?.label).toBe("Undo");
		expect(o.duration).toBe(UNDO_TOAST_MS);
		o.action?.onClick();
		await vi.waitFor(() => expect(sonner.success).toHaveBeenCalledTimes(2));
		expect(undo).toHaveBeenCalledTimes(1);
		expect(sonner.success.mock.calls.at(-1)?.[0]).toBe("Undone");
	});

	it("a failed undo says so as an error", async () => {
		showToast("Expense added", copy, {
			undo: () => Promise.reject(new Error("x")),
		});
		lastOptions(sonner.success).action?.onClick();
		await vi.waitFor(() => expect(sonner.error).toHaveBeenCalled());
		expect(sonner.error.mock.calls.at(-1)?.[0]).toBe("Couldn't undo");
	});

	it("a toast without undo has no action", () => {
		showToast("Copied", copy, { kind: "info" });
		expect(lastOptions(sonner.info).action).toBeUndefined();
	});

	it("a fourth toast dismisses the oldest", () => {
		const ids = [1, 2, 3, 4].map(() => showToast("x", copy));
		expect(sonner.dismiss).toHaveBeenCalledWith(ids[0]);
	});
});
