import { describe, expect, it, vi } from "vitest";
import { createEnableLifecycle, type KeyDraft } from "./enable-lifecycle";

const setup = () => {
	const ports = { reset: vi.fn() };
	return { ports, life: createEnableLifecycle(ports) };
};
/** A draft handle with its own wipe, named so a failure says whose it was. */
const draft = (keyText: string) => ({
	keyText,
	wipe: vi.fn<() => void>(),
});
/** A job the test settles by hand. */
const pending = <T>() => {
	let resolve: (v: T) => void = () => {};
	let reject: (e: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};
/** A sheet that holds `d` as its current draft. */
async function holding(d: KeyDraft) {
	const s = setup();
	await s.life.makeDraft(async () => d);
	return s;
}

describe("closing and unmounting", () => {
	it("closing resets the sheet and wipes its draft", async () => {
		const d = draft("one");
		const { ports, life } = await holding(d);
		life.closed();
		expect(ports.reset).toHaveBeenCalledTimes(1);
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(life.draft).toBeNull();
	});

	it("unmounting wipes the draft and resets nothing", async () => {
		const d = draft("one");
		const { ports, life } = await holding(d);
		life.unmounted();
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(ports.reset).not.toHaveBeenCalled();
	});

	it("wipes a draft once, however many exits follow", async () => {
		const d = draft("one");
		const { life } = await holding(d);
		life.back("methods");
		life.closed();
		life.unmounted();
		expect(d.wipe).toHaveBeenCalledTimes(1);
	});

	it("does nothing until one of them happens, and copes with no draft", () => {
		const { ports, life } = setup();
		expect(ports.reset).not.toHaveBeenCalled();
		expect(() => {
			life.closed();
			life.unmounted();
			life.back("methods");
		}).not.toThrow();
	});
});

describe("Back", () => {
	it("from the methods wipes the keys made for the old password", async () => {
		const d = draft("one");
		const { life } = await holding(d);
		life.back("methods");
		expect(d.wipe).toHaveBeenCalledTimes(1);
		expect(life.draft).toBeNull();
	});

	it("from every other step keeps the draft", async () => {
		const d = draft("one");
		const { life } = await holding(d);
		for (const step of ["newPassword", "saveKey", "confirmKey", "confirmYou"])
			life.back(step);
		expect(d.wipe).not.toHaveBeenCalled();
		expect(life.draft).toBe(d);
	});
});

describe("making a draft", () => {
	it("keeps the one made in time as the sheet's draft", async () => {
		const { life } = setup();
		const d = draft("one");
		expect(await life.makeDraft(async () => d)).toEqual({
			status: "done",
			value: d,
		});
		expect(life.draft).toBe(d);
		expect(d.wipe).not.toHaveBeenCalled();
	});

	it("wipes a draft that is replaced by a newer one", async () => {
		const first = draft("one");
		const { life } = await holding(first);
		const second = draft("two");
		await life.makeDraft(async () => second);
		expect(first.wipe).toHaveBeenCalledTimes(1);
		expect(second.wipe).not.toHaveBeenCalled();
		expect(life.draft).toBe(second);
	});

	it("a draft that arrives after the sheet closed wipes itself and is dropped", async () => {
		const { life } = setup();
		const job = pending<KeyDraft>();
		const run = life.makeDraft(() => job.promise);
		life.closed();
		const late = draft("late");
		job.resolve(late);
		expect(await run).toEqual({ status: "late", value: late });
		expect(late.wipe).toHaveBeenCalledTimes(1);
		expect(life.draft).toBeNull();
	});

	it("a draft that arrives after the sheet unmounted wipes itself", async () => {
		const { life } = setup();
		const job = pending<KeyDraft>();
		const run = life.makeDraft(() => job.promise);
		life.unmounted();
		const late = draft("late");
		job.resolve(late);
		await run;
		expect(late.wipe).toHaveBeenCalledTimes(1);
	});

	it("drops a failure that arrives after the sheet closed, so it cannot land in the next one", async () => {
		const { life } = setup();
		const job = pending<KeyDraft>();
		const run = life.makeDraft(() => job.promise);
		life.closed();
		job.reject(new Error("checkFailed"));
		expect(await run).toEqual({ status: "late" });
	});

	it("reports a failure in time, and keeps no draft", async () => {
		const { life } = setup();
		const boom = new Error("no");
		expect(
			await life.makeDraft(async () => {
				throw boom;
			}),
		).toEqual({ status: "failed", error: boom });
		expect(life.draft).toBeNull();
	});
});

describe("two drafts across a close and a reopen", () => {
	it("the newer one first: the late one wipes only itself", async () => {
		const { life } = setup();
		const slow = pending<KeyDraft>();
		const first = life.makeDraft(() => slow.promise);
		life.closed();
		const second = draft("two");
		await life.makeDraft(async () => second);
		const one = draft("one");
		slow.resolve(one);
		expect(await first).toEqual({ status: "late", value: one });
		expect(one.wipe).toHaveBeenCalledTimes(1);
		expect(second.wipe).not.toHaveBeenCalled();
		expect(life.draft).toBe(second);
	});

	it("the older one first: it wipes itself and the newer one still lands", async () => {
		const { life } = setup();
		const slow = pending<KeyDraft>();
		const fast = pending<KeyDraft>();
		const first = life.makeDraft(() => slow.promise);
		life.closed();
		const second = life.makeDraft(() => fast.promise);
		const one = draft("one");
		slow.resolve(one);
		await first;
		expect(one.wipe).toHaveBeenCalledTimes(1);
		const two = draft("two");
		fast.resolve(two);
		await second;
		expect(two.wipe).not.toHaveBeenCalled();
		expect(life.draft).toBe(two);
	});

	it("a save that finishes late does not touch the newer draft", async () => {
		const { life } = setup();
		const old = draft("one");
		await life.makeDraft(async () => old);
		const save = pending<void>();
		const run = life.run(() => save.promise);
		life.closed();
		expect(old.wipe).toHaveBeenCalledTimes(1);
		const fresh = draft("two");
		await life.makeDraft(async () => fresh);
		save.resolve();
		expect(await run).toEqual({ status: "late", value: undefined });
		expect(fresh.wipe).not.toHaveBeenCalled();
		expect(life.draft).toBe(fresh);
	});
});

describe("a job", () => {
	it("hands back what it made, and what made it fail, while the sheet is open", async () => {
		const { life } = setup();
		expect(await life.run(async () => "x")).toEqual({
			status: "done",
			value: "x",
		});
		const boom = new Error("no");
		expect(
			await life.run(async () => {
				throw boom;
			}),
		).toEqual({ status: "failed", error: boom });
	});

	it("is dropped when it fails after the sheet closed or unmounted", async () => {
		for (const exit of ["closed", "unmounted"] as const) {
			const { life } = setup();
			const job = pending<string>();
			const run = life.run(() => job.promise);
			life[exit]();
			job.reject(new Error("checkFailed"));
			expect(await run).toEqual({ status: "late" });
		}
	});

	it("is still late when the sheet was reopened before it finished", async () => {
		const { life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.closed();
		expect(await life.run(async () => "second")).toEqual({
			status: "done",
			value: "second",
		});
		job.resolve("first");
		expect(await run).toEqual({ status: "late", value: "first" });
	});
});

describe("one job at a time", () => {
	it("ignores a second press while the first works, then accepts another", async () => {
		const { life } = setup();
		const job = vi.fn(() => pending<string>().promise);
		const first = pending<string>();
		const run = life.run(() => first.promise);
		expect(life.running).toBe(true);
		expect(await life.run(job)).toEqual({ status: "ignored" });
		expect(job).not.toHaveBeenCalled();
		first.resolve("ok");
		await run;
		expect(life.running).toBe(false);
		expect(await life.run(async () => "again")).toEqual({
			status: "done",
			value: "again",
		});
	});

	it("does not close while a job works, and does after it ends, even by failure", async () => {
		const { life } = setup();
		expect(life.canClose()).toBe(true);
		const job = pending<string>();
		const run = life.run(() => job.promise);
		expect(life.canClose()).toBe(false);
		job.reject(new Error("x"));
		await run;
		expect(life.canClose()).toBe(true);
	});

	it("does not leave the reopened sheet stuck working behind the old job", async () => {
		const { life } = setup();
		const old = pending<string>();
		const oldRun = life.run(() => old.promise);
		life.closed();
		expect(life.running).toBe(false);
		expect(life.canClose()).toBe(true);
		const fresh = pending<string>();
		const freshRun = life.run(() => fresh.promise);
		// The old job ending must not free the new job's flag.
		old.resolve("old");
		await oldRun;
		expect(life.running).toBe(true);
		fresh.resolve("new");
		expect(await freshRun).toEqual({ status: "done", value: "new" });
	});
});
