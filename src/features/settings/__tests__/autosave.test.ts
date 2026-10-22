import { describe, expect, it, vi } from "vitest";
import { type AutosaveReport, saveField } from "../autosave";

const copy = { saved: "Saved", failed: "Couldn't save" };

function reporter() {
	const calls: { saved: [string, boolean][]; failed: string[] } = {
		saved: [],
		failed: [],
	};
	let undo: (() => Promise<unknown>) | undefined;
	const report: AutosaveReport = {
		saved: (message, u) => {
			calls.saved.push([message, !!u]);
			undo = u;
		},
		failed: (message) => calls.failed.push(message),
	};
	return { calls, report, undo: () => undo?.() };
}

describe("saveField", () => {
	it("writes the new value and offers Undo that writes the old one back", async () => {
		const apply = vi.fn(async (_v: string) => {});
		const r = reporter();
		const ok = await saveField(
			{ apply, next: "ARS", prev: "USD", message: "Home currency is now ARS" },
			r.report,
			copy,
		);
		expect(ok).toBe(true);
		expect(apply).toHaveBeenCalledWith("ARS");
		expect(r.calls.saved).toEqual([["Home currency is now ARS", true]]);
		await r.undo();
		expect(apply).toHaveBeenLastCalledWith("USD");
	});

	it("says nothing and writes nothing when the value did not change", async () => {
		const apply = vi.fn(async (_v: number) => {});
		const r = reporter();
		expect(await saveField({ apply, next: 5, prev: 5 }, r.report, copy)).toBe(
			false,
		);
		expect(apply).not.toHaveBeenCalled();
		expect(r.calls.saved).toEqual([]);
	});

	it("uses the comparer for values that are objects", async () => {
		const apply = vi.fn(async (_v: { a: number }) => {});
		const r = reporter();
		const same = (x: { a: number }, y: { a: number }) => x.a === y.a;
		expect(
			await saveField(
				{ apply, next: { a: 1 }, prev: { a: 1 } },
				r.report,
				copy,
				same,
			),
		).toBe(false);
		expect(apply).not.toHaveBeenCalled();
	});

	it("reports the server message when the write fails, and no Saved", async () => {
		const r = reporter();
		const ok = await saveField(
			{
				apply: async () => {
					throw new Error("Username is already taken");
				},
				next: "sofia",
				prev: "sofi",
			},
			r.report,
			copy,
		);
		expect(ok).toBe(false);
		expect(r.calls.failed).toEqual(["Username is already taken"]);
		expect(r.calls.saved).toEqual([]);
	});

	it("falls back to the page copy for an error without a message", async () => {
		const r = reporter();
		await saveField(
			{
				apply: async () => {
					throw new Error("");
				},
				next: true,
				prev: false,
			},
			r.report,
			copy,
		);
		expect(r.calls.failed).toEqual(["Couldn't save"]);
	});

	it("offers no Undo for a change that cannot be reversed", async () => {
		const r = reporter();
		await saveField(
			{ apply: async () => {}, next: "a", prev: "b", undoable: false },
			r.report,
			copy,
		);
		expect(r.calls.saved).toEqual([["Saved", false]]);
	});
});
