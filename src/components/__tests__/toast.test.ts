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

const {
	MAX_TOASTS,
	openSheetCount,
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

	it("counts open sheets; release is idempotent", () => {
		const before = openSheetCount();
		const a = trackOpenSheet();
		const b = trackOpenSheet();
		expect(openSheetCount()).toBe(before + 2);
		a();
		a();
		expect(openSheetCount()).toBe(before + 1);
		b();
		expect(openSheetCount()).toBe(before);
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
