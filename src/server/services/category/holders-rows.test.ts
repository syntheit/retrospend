/**
 * Catches: a shared expense the caller cannot write being told apart from a
 * failure that is not about the row. Only a row-level security refusal counts
 * the row as set to no category; any other error, a missing grant included,
 * stops the merge.
 */
import { describe, expect, it, vi } from "vitest";
import type { MergeCtx } from "./holder";
import { sharedTransactionHolder } from "./holders-rows";

function ctxFailing(error: Error) {
	const executeRaw = vi.fn().mockResolvedValue(0);
	const updateManyAndReturn = vi.fn().mockRejectedValue(error);
	const findMany = vi.fn().mockResolvedValue([{ id: "t1" }]);
	const ctx = {
		tx: {
			$executeRaw: executeRaw,
			sharedTransaction: { updateManyAndReturn, findMany },
		},
		userId: "u",
		sourceId: "src",
		targetId: "tgt",
		stamp: new Date(),
	} as unknown as MergeCtx;
	return { ctx, executeRaw };
}

describe("a shared expense the caller cannot write", () => {
	it("counts a row-level security refusal as set to no category and goes on", async () => {
		const { ctx, executeRaw } = ctxFailing(
			new Error(
				'new row violates row-level security policy for table "shared_transaction"',
			),
		);
		const done = await sharedTransactionHolder.move(ctx);
		expect(done.held.setToNone).toBe(1);
		expect(executeRaw).toHaveBeenCalledTimes(2);
	});

	it("rethrows a missing grant, which is also 42501", async () => {
		const { ctx } = ctxFailing(
			Object.assign(
				new Error("permission denied for table shared_transaction"),
				{
					code: "42501",
					meta: { code: "42501" },
				},
			),
		);
		await expect(sharedTransactionHolder.move(ctx)).rejects.toThrow(
			/permission denied/,
		);
	});
});
