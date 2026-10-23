import { describe, expect, it, vi } from "vitest";
import { type AutosaveReport, makeSaveGuard, saveField } from "../autosave";

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

	it("says it could not save in the page's words, not the server's, and puts the screen back", async () => {
		const r = reporter();
		const restore = vi.fn();
		const ok = await saveField(
			{
				apply: async () => {
					throw new Error("Internal server error");
				},
				next: true,
				prev: false,
				restore,
			},
			r.report,
			copy,
		);
		expect(ok).toBe(false);
		expect(r.calls.failed).toEqual(["Couldn't save"]);
		expect(r.calls.saved).toEqual([]);
		expect(restore).toHaveBeenCalledWith(false);
	});

	it("lets a field name its own failure", async () => {
		const r = reporter();
		await saveField(
			{
				apply: async () => {
					throw new Error("Username is already taken");
				},
				next: "sofia",
				prev: "sofi",
				failedMessage: () => "That username is taken",
			},
			r.report,
			copy,
		);
		expect(r.calls.failed).toEqual(["That username is taken"]);
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

describe("makeSaveGuard", () => {
	it("drops a second change to a field while the first is saving", async () => {
		const guard = makeSaveGuard();
		let finish: () => void = () => {};
		const write = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = () => resolve("first");
				}),
		);
		const first = guard("homeCurrency", write);
		const second = await guard("homeCurrency", write);
		expect(second).toBeUndefined();
		expect(write).toHaveBeenCalledTimes(1);
		finish();
		expect(await first).toBe("first");
		// Free again once the first write is done, and other fields never wait.
		await guard("homeCurrency", async () => "again");
		expect(await guard("language", async () => "other")).toBe("other");
	});

	it("frees the field after a failed write", async () => {
		const guard = makeSaveGuard();
		await expect(
			guard("theme", async () => {
				throw new Error("x");
			}),
		).rejects.toThrow("x");
		expect(await guard("theme", async () => 1)).toBe(1);
	});
});
