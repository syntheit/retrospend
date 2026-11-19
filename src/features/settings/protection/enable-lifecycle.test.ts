import { describe, expect, it, vi } from "vitest";
import { createEnableLifecycle } from "./enable-lifecycle";

const setup = () => {
	const ports = { discard: vi.fn(), reset: vi.fn() };
	return { ports, life: createEnableLifecycle(ports) };
};
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

describe("closing and unmounting", () => {
	it("closing resets the sheet and wipes the draft", () => {
		const { ports, life } = setup();
		life.closed();
		expect(ports.reset).toHaveBeenCalledTimes(1);
		expect(ports.discard).toHaveBeenCalledTimes(1);
	});

	it("unmounting wipes the draft", () => {
		const { ports, life } = setup();
		life.unmounted();
		expect(ports.discard).toHaveBeenCalledTimes(1);
		expect(ports.reset).not.toHaveBeenCalled();
	});

	it("does nothing until one of them happens", () => {
		const { ports } = setup();
		expect(ports.discard).not.toHaveBeenCalled();
		expect(ports.reset).not.toHaveBeenCalled();
	});
});

describe("Back", () => {
	it("from the methods wipes the keys made for the old password", () => {
		const { ports, life } = setup();
		life.back("methods");
		expect(ports.discard).toHaveBeenCalledTimes(1);
	});

	it("from every other step keeps the draft", () => {
		const { ports, life } = setup();
		for (const step of ["newPassword", "saveKey", "confirmKey", "confirmYou"])
			life.back(step);
		expect(ports.discard).not.toHaveBeenCalled();
	});
});

describe("a job", () => {
	it("hands back what it made, and what made it fail, while the sheet is open", async () => {
		const { ports, life } = setup();
		expect(await life.run(async () => "keys")).toEqual({
			status: "done",
			value: "keys",
		});
		const boom = new Error("no");
		expect(
			await life.run(async () => {
				throw boom;
			}),
		).toEqual({ status: "failed", error: boom });
		expect(ports.discard).not.toHaveBeenCalled();
	});

	it("is dropped and its draft wiped when it succeeds after the sheet closed", async () => {
		const { ports, life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.closed();
		expect(ports.discard).toHaveBeenCalledTimes(1);
		job.resolve("keys");
		expect(await run).toEqual({ status: "late" });
		expect(ports.discard).toHaveBeenCalledTimes(2);
	});

	it("is dropped and its draft wiped when it succeeds after the sheet unmounted", async () => {
		const { ports, life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.unmounted();
		job.resolve("keys");
		expect(await run).toEqual({ status: "late" });
		expect(ports.discard).toHaveBeenCalledTimes(2);
	});

	it("drops a failure that arrives after the sheet closed, so it cannot land in the next one", async () => {
		const { ports, life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.closed();
		job.reject(new Error("checkFailed"));
		expect(await run).toEqual({ status: "late" });
		expect(ports.discard).toHaveBeenCalledTimes(2);
	});

	it("drops a failure that arrives after the sheet unmounted", async () => {
		const { life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.unmounted();
		job.reject(new Error("checkFailed"));
		expect(await run).toEqual({ status: "late" });
	});

	it("is still late when the sheet was reopened before it finished", async () => {
		const { life } = setup();
		const job = pending<string>();
		const run = life.run(() => job.promise);
		life.closed();
		// A new sheet starts a new job; the first one is the old sheet's.
		expect(await life.run(async () => "second")).toEqual({
			status: "done",
			value: "second",
		});
		job.resolve("first");
		expect(await run).toEqual({ status: "late" });
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
});
