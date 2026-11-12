import { afterEach, describe, expect, it, vi } from "vitest";
import { insideTransaction } from "../db-tx";
import {
	epochActiveNow,
	loadEpoch,
	markEpochActive,
	NOT_SET_TTL_MS,
	resetEpochForTests,
	setEpochReader,
} from "./epoch";

afterEach(() => {
	resetEpochForTests();
	setEpochReader(undefined);
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("the field encryption epoch cache", () => {
	it("keeps a set epoch forever, with no further query", async () => {
		const read = vi.fn(async () => true);
		setEpochReader(read);
		expect(await loadEpoch()).toBe(true);
		vi.useFakeTimers();
		vi.advanceTimersByTime(24 * 60 * 60 * 1000);
		expect(await loadEpoch()).toBe(true);
		expect(epochActiveNow()).toBe(true);
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("keeps 'not set' for 30 seconds, then asks again", async () => {
		vi.useFakeTimers();
		let set = false;
		const read = vi.fn(async () => set);
		setEpochReader(read);
		expect(await loadEpoch()).toBe(false);
		set = true;
		vi.advanceTimersByTime(NOT_SET_TTL_MS - 1);
		expect(await loadEpoch()).toBe(false);
		vi.advanceTimersByTime(1);
		expect(await loadEpoch()).toBe(true);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("shares one read between concurrent loads", async () => {
		const read = vi.fn(async () => true);
		setEpochReader(read);
		await Promise.all([loadEpoch(), loadEpoch(), loadEpoch()]);
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("counts an unreadable epoch as set, logs only its kind, and never caches it", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		let calls = 0;
		const answers = [false, true];
		setEpochReader(async () => {
			if (calls++ === 0)
				throw new Error(
					"column app_settings.fieldEncryptionSince does not exist",
				);
			return answers.shift() as boolean;
		});
		expect(await loadEpoch()).toBe(true);
		expect(epochActiveNow()).toBe(true);
		expect(error).toHaveBeenCalledWith("Field encryption epoch read failed", {
			error: "Error",
		});
		// The next load reads again; a success replaces the unknown.
		expect(await loadEpoch()).toBe(false);
		expect(epochActiveNow()).toBe(false);
		expect(calls).toBe(2);
	});

	it("does not fall back on an old 'not set' when the next read fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.useFakeTimers();
		let calls = 0;
		setEpochReader(async () => {
			if (calls++ === 0) return false;
			throw new Error("connection reset");
		});
		expect(await loadEpoch()).toBe(false);
		vi.advanceTimersByTime(NOT_SET_TTL_MS);
		expect(await loadEpoch()).toBe(true);
		expect(epochActiveNow()).toBe(true);
	});

	it("with a read that fails once, then finds the epoch, answers set throughout", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let calls = 0;
		setEpochReader(async () => {
			if (calls++ === 0) throw new Error("connection reset");
			return true;
		});
		expect(await loadEpoch()).toBe(true);
		expect(await loadEpoch()).toBe(true);
		expect(await loadEpoch()).toBe(true);
		expect(calls).toBe(2);
	});

	it("counts a process that never read it as set once a reader is wired, and as not set with none", () => {
		expect(epochActiveNow()).toBe(false);
		setEpochReader(async () => false);
		expect(epochActiveNow()).toBe(true);
	});

	it("never queries inside a transaction: the cached answer stands", async () => {
		let set = false;
		const read = vi.fn(async () => set);
		setEpochReader(read);
		// Never read: unknown counts as set.
		expect(await insideTransaction(() => loadEpoch())).toBe(true);
		expect(read).not.toHaveBeenCalled();
		expect(await loadEpoch()).toBe(false);
		set = true;
		expect(await insideTransaction(() => loadEpoch())).toBe(false);
		expect(read).toHaveBeenCalledTimes(1);
		markEpochActive();
		expect(await insideTransaction(() => loadEpoch())).toBe(true);
		expect(read).toHaveBeenCalledTimes(1);
	});
});
