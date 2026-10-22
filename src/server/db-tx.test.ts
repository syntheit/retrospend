import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "~prisma";
import { userTransaction } from "./db-tx";

/** A client whose transaction hands out a tx that records each statement and when it ran. */
function fakeClient() {
	const log: string[] = [];
	const tx = {
		$executeRaw: vi.fn(
			async (sql: TemplateStringsArray, ...values: unknown[]) => {
				log.push(`sql ${sql.join("?")} ${JSON.stringify(values)}`);
				return 1;
			},
		),
	} as unknown as Prisma.TransactionClient;
	const client = {
		$transaction: vi.fn(async (fn: (tx: Prisma.TransactionClient) => unknown) =>
			fn(tx),
		),
	} as unknown as Pick<PrismaClient, "$transaction">;
	return { client, tx, log };
}

describe("userTransaction", () => {
	it("sets the RLS user and role before the work runs, in the same transaction", async () => {
		const { client, tx, log } = fakeClient();

		const result = await userTransaction(client, "user-1", async (inner) => {
			expect(inner).toBe(tx);
			log.push("work");
			return 42;
		});

		expect(result).toBe(42);
		expect(log).toHaveLength(2);
		expect(log[0]).toContain("set_config('app.current_user_id', ?, true)");
		expect(log[0]).toContain("set_config('role', 'retrospend_app', true)");
		expect(log[0]).toContain('["user-1"]');
		expect(log[1]).toBe("work");
	});

	it("lets the work's error reach the caller so the transaction rolls back", async () => {
		const { client } = fakeClient();
		const failure = new Error("nope");

		await expect(
			userTransaction(client, "user-1", async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
	});

	it("passes the isolation level and timeout to Prisma", async () => {
		const { client } = fakeClient();
		const options = {
			isolationLevel: "RepeatableRead",
			timeout: 15_000,
		} as const;

		await userTransaction(client, "user-1", async () => null, options);

		expect(client.$transaction).toHaveBeenCalledWith(
			expect.any(Function),
			options,
		);
	});
});
