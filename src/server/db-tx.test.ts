import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "~prisma";
import {
	inPreview,
	insidePreview,
	inTransaction,
	keystoreTransaction,
	outsideTransaction,
	registerClient,
	registerKeystoreClient,
	userTransaction,
} from "./db-tx";

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

/** A fake that db-core.ts would have registered: its crypto client is itself. */
function registeredClient() {
	const made = fakeClient();
	const ready = vi.fn(async () => {});
	registerClient(made.client, () => ({ client: made.client, ready }));
	return { ...made, ready };
}

describe("userTransaction", () => {
	it("sets the RLS user and role before the work runs, in the same transaction", async () => {
		const { client, tx, log } = registeredClient();

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
		const { client } = registeredClient();
		const failure = new Error("nope");

		await expect(
			userTransaction(client, "user-1", async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
	});

	it("passes the isolation level and timeout to Prisma", async () => {
		const { client } = registeredClient();
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

	it("leaves the transaction scope for work outside it, and marks only preview work", async () => {
		const { client } = registeredClient();
		const seen: boolean[] = [];

		await userTransaction(client, "user-1", () =>
			insidePreview(async () => {
				seen.push(inPreview(), inTransaction());
				await outsideTransaction(async () => seen.push(inTransaction()));
			}),
		);
		await userTransaction(client, "user-1", async () => {
			seen.push(inPreview());
		});

		expect(seen).toEqual([true, true, false, false]);
		expect(inPreview()).toBe(false);
	});

	it("waits for the user's keys before it opens the transaction", async () => {
		const { client, ready } = registeredClient();
		await userTransaction(client, "user-1", async () => null);
		expect(ready).toHaveBeenCalledTimes(1);
		expect(ready.mock.invocationCallOrder[0]).toBeLessThan(
			(client.$transaction as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0] as number,
		);
	});

	it("throws for a client that db.ts did not build, and runs no query", async () => {
		const { client } = fakeClient();
		await expect(
			userTransaction(client, "user-1", async () => 1),
		).rejects.toThrow(/needs the client from db.ts/);
		expect(client.$transaction).not.toHaveBeenCalled();
	});
});

describe("keystoreTransaction", () => {
	it("runs a registered keystore client as the user, with no key load", async () => {
		const { client, log } = fakeClient();
		registerKeystoreClient(client);
		await keystoreTransaction(client, "user-1", async () => {
			log.push("work");
		});
		expect(log[0]).toContain("set_config('app.current_user_id', ?, true)");
		expect(log[1]).toBe("work");
	});

	it("throws for any other client, registered for users or not", async () => {
		const plain = fakeClient();
		await expect(
			keystoreTransaction(plain.client, "user-1", async () => 1),
		).rejects.toThrow(/keystoreDb only/);
		const crypto = registeredClient();
		await expect(
			keystoreTransaction(crypto.client, "user-1", async () => 1),
		).rejects.toThrow(/keystoreDb only/);
		expect(plain.client.$transaction).not.toHaveBeenCalled();
		expect(crypto.client.$transaction).not.toHaveBeenCalled();
	});
});
