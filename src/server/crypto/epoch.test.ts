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
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("the field encryption epoch cache", () => {
	it("keeps a set epoch forever, with no further query", async () => {
		const read = vi.fn(async () => true);
		setEpochReader(read);
		expect(epochActiveNow()).toBe(false);
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

	it("reads an unreadable column as not set and logs only its kind", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		setEpochReader(async () => {
			throw new Error(
				"column app_settings.fieldEncryptionSince does not exist",
			);
		});
		expect(await loadEpoch()).toBe(false);
		expect(error).toHaveBeenCalledWith("Field encryption epoch read failed", {
			error: "Error",
			sqlstate: null,
		});
	});

	it("never queries inside a transaction: the cached answer stands", async () => {
		const read = vi.fn(async () => true);
		setEpochReader(read);
		expect(await insideTransaction(() => loadEpoch())).toBe(false);
		expect(read).not.toHaveBeenCalled();
		markEpochActive();
		expect(await insideTransaction(() => loadEpoch())).toBe(true);
		expect(read).not.toHaveBeenCalled();
	});
});
