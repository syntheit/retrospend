import { describe, expect, it, vi } from "vitest";
import { PreviewBusyError, runTransaction } from "./busy";

const serialization = (code = "P2034") =>
	Object.assign(new Error("could not serialize access"), { code });

// What @prisma/adapter-pg and Prisma really produce: a raw query's 40001 and
// 40P01 are a TransactionWriteConflict with the SQLSTATE in originalCode and
// no `code`, wrapped as P2010 (not P2034).
const driverCancelled = (sqlstate: string) =>
	Object.assign(new Error("cancelled"), {
		code: "P2010",
		meta: {
			driverAdapterError: {
				cause: { kind: "TransactionWriteConflict", originalCode: sqlstate },
			},
		},
	});

describe("runTransaction", () => {
	it("retries a preview once after P2034, 40001 or 40P01 and returns the second answer", async () => {
		for (const failure of [
			serialization(),
			driverCancelled("40001"),
			driverCancelled("40P01"),
			new Error("wrapped", { cause: serialization() }),
		]) {
			const run = vi
				.fn<() => Promise<string>>()
				.mockRejectedValueOnce(failure)
				.mockResolvedValueOnce("ok");
			await expect(runTransaction("preview", run)).resolves.toBe("ok");
			expect(run).toHaveBeenCalledTimes(2);
		}
	});

	it("throws PreviewBusyError after a second failure, keeping the database error as cause", async () => {
		const second = serialization();
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(serialization())
			.mockRejectedValueOnce(second);
		const thrown = await runTransaction("preview", run).catch(
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(PreviewBusyError);
		expect((thrown as PreviewBusyError).cause).toBe(second);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("does not retry any other error, and never retries an apply", async () => {
		const other = new Error("sentinel");
		const preview = vi.fn().mockRejectedValue(other);
		await expect(runTransaction("preview", preview)).rejects.toBe(other);
		expect(preview).toHaveBeenCalledTimes(1);

		const conflict = serialization();
		const apply = vi.fn().mockRejectedValue(conflict);
		await expect(runTransaction("apply", apply)).rejects.toBe(conflict);
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("lets a different second error through unchanged", async () => {
		const other = new Error("sentinel");
		const run = vi
			.fn()
			.mockRejectedValueOnce(serialization())
			.mockRejectedValueOnce(other);
		await expect(runTransaction("preview", run)).rejects.toBe(other);
	});
});
