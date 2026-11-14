/**
 * A book that turns shared or personal while a child row is being written, on
 * real Postgres with two connections (E2EE lane P, P14c). The child row's
 * foreign key holds KEY SHARE on the book row, which an UPDATE of the book
 * does not conflict with, so the hand-over takes FOR UPDATE on the book first:
 * it waits for the open insert and then stamps that row too, or the insert
 * waits and its own trigger sees the new state. Without the lock the row is
 * never stamped (or keeps a U in a shared book).
 *
 * A perf-named file only for where it runs: alone, after every other file. Its
 * open insert holds back the commit cut of the sync feed for every worker, which
 * would make other files' paging tests see a stamp late.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { readChanges } from "./changes";
import { seedBook } from "./sync-book-test-support";
import { stampOf, until } from "./sync-test-support";

/**
 * Inserts an envelope in a transaction that stays open, starts `act` on a
 * second connection (it blocks on the book row), then commits the insert and
 * lets `act` finish. Returns the new envelope's id.
 */
async function raceWithInsert(
	bookId: string,
	act: (client: Client) => Promise<unknown>,
): Promise<string> {
	const id = randomUUID();
	let opened: () => void = () => {};
	const insertedRow = new Promise<void>((resolve) => {
		opened = resolve;
	});
	let commit: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		commit = resolve;
	});
	const writer = fixtureDb.$transaction(
		async (tx) => {
			await tx.envelope.create({
				data: { id, bookId, name: "Raced", sortOrder: 9 },
			});
			opened();
			await gate;
		},
		{ timeout: 60_000, maxWait: 60_000 },
	);
	await insertedRow;

	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		await client.query("BEGIN");
		const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
			.pid as number;
		let settled = false;
		const acting = act(client).finally(() => {
			settled = true;
		});
		// Wait until the second connection is waiting on a lock (the book row
		// held by the open insert), or has finished (no lock: the bug).
		for (let i = 0; i < 100 && !settled; i++) {
			const waiting = await adminDb.$queryRaw<{ n: number }[]>`
				SELECT count(*)::int AS n FROM pg_stat_activity
				WHERE pid = ${pid} AND wait_event_type = 'Lock'`;
			if ((waiting[0]?.n ?? 0) > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		commit();
		await writer;
		await acting;
		await client.query("COMMIT");
	} finally {
		commit();
		await client.end();
	}
	return id;
}

const addMember = (bookId: string, userId: string) => (client: Client) =>
	client.query(
		`INSERT INTO budget_member ("id","bookId","userId","role") VALUES ($1,$2,$3,'EDITOR')`,
		[randomUUID(), bookId, userId],
	);

describe("a hand-over races a child row written at the same time", () => {
	it("a member leaving makes the book personal again: the envelope inserted meanwhile is stamped U and read", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest.user.id, role: "EDITOR" },
		});
		const id = await raceWithInsert(s.book, (client) =>
			client.query(
				`DELETE FROM budget_member WHERE "bookId" = $1 AND "userId" = $2`,
				[s.book, guest.user.id],
			),
		);
		expect((await stampOf(owner.user.id, "envelope", id))?.op).toBe("U");
		expect((await stampOf(owner.user.id, "envelope", s.rent))?.op).toBe("U");
		const page = await until(
			() => readChanges(adminDb, owner.user.id, "envelope", { limit: 100 }),
			(p) => p.items.length >= 3,
		);
		expect(page.items.map((r) => r.id)).toContain(id);
	});

	it("isPersonal turning true again: the envelope inserted meanwhile is stamped U", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { isPersonal: false },
		});
		const id = await raceWithInsert(s.book, (client) =>
			client.query(
				`UPDATE budget_book SET "isPersonal" = true WHERE "id" = $1`,
				[s.book],
			),
		);
		expect((await stampOf(user.id, "envelope", id))?.op).toBe("U");
	});

	it("a member arriving makes the book shared: the envelope inserted meanwhile ends as D, not a leaked U", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		const id = await raceWithInsert(s.book, addMember(s.book, guest.user.id));
		expect((await stampOf(owner.user.id, "envelope", id))?.op).toBe("D");
		expect((await stampOf(owner.user.id, "envelope", s.rent))?.op).toBe("D");
	});

	it("isPersonal turning false: the envelope inserted meanwhile ends as D", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		const id = await raceWithInsert(s.book, (client) =>
			client.query(
				`UPDATE budget_book SET "isPersonal" = false WHERE "id" = $1`,
				[s.book],
			),
		);
		expect((await stampOf(user.id, "envelope", id))?.op).toBe("D");
	});
});
