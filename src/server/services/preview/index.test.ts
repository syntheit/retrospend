import { describe, expect, it, vi } from "vitest";
import type { MoneyMutation } from "./types";

const { userTransaction } = vi.hoisted(() => ({
	userTransaction: vi.fn(
		async (
			_db: unknown,
			_userId: string,
			work: (tx: unknown) => unknown,
			_options?: unknown,
		) => work({}),
	),
}));

vi.mock("~/server/db", () => ({ db: { name: "global" } }));
vi.mock("~/server/db-tx", () => ({ userTransaction }));

const { forUser } = await import("./index");

const noop: MoneyMutation<null, null> = {
	id: "test.noop",
	touches: [],
	run: async () => ({
		value: null,
		undo: { kind: "revert", mutation: "test.noop", rows: [] },
	}),
};

describe("forUser", () => {
	it("previews at repeatable read with a longer timeout, applies at read committed", async () => {
		const runner = forUser("user-1");

		await runner.preview(noop, null);
		await runner.apply(noop, null);

		const opened = userTransaction.mock.calls.map(([, userId, , options]) => [
			userId,
			options,
		]);
		expect(opened).toEqual([
			["user-1", { isolationLevel: "RepeatableRead", timeout: 15_000 }],
			["user-1", { isolationLevel: "ReadCommitted" }],
		]);
	});
});
