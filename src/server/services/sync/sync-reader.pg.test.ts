/**
 * The delta reader on real Postgres (E2EE lane P, P14a): first pulls and
 * paging, commit order under open transactions (the events feed's race, with
 * real triggers), rows that change or vanish between the stamp read and the
 * row read, cursors the log cannot honor, the tombstone sweep and its floor,
 * and isolation between users. Page contents are derived by hand from the
 * rows each test writes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	encodeCursor,
	InvalidCursorError,
} from "~/server/services/api-v1/cursor";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	loadPage,
	readChanges,
	readStamps,
	SyncResetRequiredError,
} from "./changes";
import type { SyncEntity } from "./entities";
import { DAY, seedPersonal, stampsOf, until } from "./sync-test-support";
import { sweepSyncTombstones } from "./tombstones";

const base = {
	title: "Row",
	currency: "ARS",
	date: DAY,
	amountInUSD: "0.01",
	exchangeRate: "1468",
	pricingSource: "MANUAL",
};

async function expenses(userId: string, count: number, amount = "1") {
	const made: string[] = [];
	for (let i = 0; i < count; i++) {
		const row = await fixtureDb.expense.create({
			data: { ...base, userId, amount },
			select: { id: true },
		});
		made.push(row.id);
	}
	return made;
}

const pullOf = <E extends SyncEntity>(
	entity: E,
	userId: string,
	query: { since?: string; limit: number } = { limit: 500 },
) => readChanges(adminDb, userId, entity, query);

const pull = (
	userId: string,
	query: { since?: string; limit: number } = { limit: 500 },
) => pullOf("expense", userId, query);

/** Every id on every page, in order, following the cursor to the end. */
async function drain(userId: string, limit: number) {
	const pages = [];
	let since: string | undefined;
	for (;;) {
		const page = await until(
			() => pull(userId, { since, limit }),
			(p) => p.items.length + p.tombstones.length > 0 || !p.hasMore,
		);
		pages.push(page);
		if (!page.hasMore) return pages;
		since = page.cursor;
	}
}

/**
 * A pull from the start, then a pull with its cursor, accepted. Retried: the
 * cut waits for every older transaction in the cluster, and other workers
 * run some.
 */
const caughtUp = (userId: string) =>
	until(
		async () => {
			const first = await pull(userId);
			return pull(userId, { since: first.cursor, limit: 10 }).then(
				() => true,
				(error) => {
					if (error instanceof SyncResetRequiredError) return false;
					throw error;
				},
			);
		},
		(ok) => ok,
	);

beforeAll(async () => {
	// A worker's database is a copy of the template: a start runs this check.
	const { checkSyncRestore } = await import("./restore");
	await checkSyncRestore();
});

describe("a first pull", () => {
	it("returns every row once, none twice, and no tombstones", async () => {
		const { user } = await createTestUser();
		const made = await expenses(user.id, 7);
		const page = await until(
			() => pull(user.id),
			(p) => p.items.length === 7,
		);
		expect(page.items.map((r) => r.id).sort()).toEqual([...made].sort());
		expect(page.tombstones).toEqual([]);
		expect(page.hasMore).toBe(false);
		expect(typeof page.cursor).toBe("string");
	});

	it("pages by commit order: 7 rows at limit 3 are 3, 3, 1, in the order written", async () => {
		const { user } = await createTestUser();
		const made = await expenses(user.id, 7);
		await until(
			() => pull(user.id),
			(p) => p.items.length === 7,
		);
		const pages = await drain(user.id, 3);
		expect(pages.map((p) => p.items.length)).toEqual([3, 3, 1]);
		expect(pages.map((p) => p.hasMore)).toEqual([true, true, false]);
		expect(pages.flatMap((p) => p.items.map((r) => r.id))).toEqual(made);
	});

	it("at the maximum page size, 600 rows are 500 then 100", async () => {
		const { user } = await createTestUser();
		await fixtureDb.expense.createMany({
			data: Array.from({ length: 600 }, () => ({
				...base,
				userId: user.id,
				amount: "1",
			})),
		});
		await until(
			() => stampsOf(user.id, "expense"),
			(s) => s.length === 600,
		);
		const first = await until(
			() => pull(user.id, { limit: 500 }),
			(p) => p.items.length === 500,
		);
		expect(first.items).toHaveLength(500);
		expect(first.hasMore).toBe(true);
		const second = await pull(user.id, {
			since: first.cursor,
			limit: 500,
		});
		expect(second.items).toHaveLength(100);
		expect(second.hasMore).toBe(false);
		const all = new Set([...first.items, ...second.items].map((r) => r.id));
		expect(all.size).toBe(600);
	}, 60_000);

	it("a user with nothing gets an empty page and a caught-up cursor that is accepted", async () => {
		const { user } = await createTestUser();
		const page = await pull(user.id);
		expect(page).toMatchObject({ items: [], tombstones: [], hasMore: false });
		expect(typeof page.cursor).toBe("string");
		await expect(
			pull(user.id, { since: page.cursor, limit: 10 }),
		).resolves.toMatchObject({ items: [], tombstones: [], hasMore: false });
	});

	it("each entity reads its own stamps: the nine-table seed is one page per entity", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const accounts = await until(
			() => pullOf("asset_account", user.id, { limit: 500 }),
			(p) => p.items.length === 2,
		);
		expect(accounts.items.map((a) => a.id).sort()).toEqual(
			[s.account, s.other].sort(),
		);
		const categories = await until(
			() => pullOf("category", user.id, { limit: 500 }),
			(p) => p.items.length === 1,
		);
		expect(categories.items[0]?.id).toBe(s.category);
	});
});

describe("deletes and changes after a cursor", () => {
	it("a changed row comes again in its new state; a deleted one comes as a tombstone; no id is in both lists", async () => {
		const { user } = await createTestUser();
		const [keep, change, remove] = await expenses(user.id, 3, "5");
		const first = await until(
			() => pull(user.id),
			(p) => p.items.length === 3,
		);
		await adminDb.expense.update({
			where: { id: change },
			data: { amount: "99" },
		});
		await adminDb.expense.delete({ where: { id: remove } });
		const next = await until(
			() => pull(user.id, { since: first.cursor, limit: 500 }),
			(p) => p.items.length + p.tombstones.length === 2,
		);
		expect(next.items.map((r) => [r.id, r.amount.toString()])).toEqual([
			[change, "99"],
		]);
		expect(next.tombstones.map((t) => t.id)).toEqual([remove]);
		expect(next.items.map((r) => r.id)).not.toContain(keep);
		const listed = [
			...next.items.map((r) => r.id),
			...next.tombstones.map((t) => t.id),
		];
		expect(new Set(listed).size).toBe(listed.length);
		expect(next.tombstones[0]?.deletedAt).toBeInstanceOf(Date);
	});

	it("a SET NULL change shows the expense with categoryId null", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const first = await until(
			() => pull(user.id),
			(p) => p.items.length === 1,
		);
		expect(first.items[0]?.categoryId).toBe(s.category);
		await adminDb.category.delete({ where: { id: s.category } });
		const next = await until(
			() => pull(user.id, { since: first.cursor, limit: 500 }),
			(p) => p.items.length === 1,
		);
		expect(next.items[0]).toMatchObject({ id: s.expense, categoryId: null });
	});

	it("a leg insert shows the account at its new balance", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const first = await until(
			() => pullOf("asset_account", user.id, { limit: 500 }),
			(p) => p.items.length === 2,
		);
		await fixtureDb.accountLeg.create({
			data: {
				userId: user.id,
				accountId: s.account,
				currency: "ARS",
				amount: "25",
				date: DAY,
				source: "TRANSFER",
				transferId: s.transfer,
			},
		});
		const next = await until(
			() =>
				pullOf("asset_account", user.id, { since: first.cursor, limit: 500 }),
			(p) => p.items.length === 1,
		);
		// 1000 - 50 (the seed's transfer leg) + 25.
		expect(next.items[0]).toMatchObject({ id: s.account });
		expect(next.items[0]?.balance.toString()).toBe("975");
	});
});

describe("no change is skipped behind a cursor", () => {
	it("a late commit never appears behind a cursor a client holds (stamps from real triggers)", async () => {
		const { user } = await createTestUser();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let opened: () => void = () => undefined;
		const hasOpened = new Promise<void>((r) => {
			opened = r;
		});
		const insert = (
			tx: Parameters<Parameters<typeof userTransaction>[2]>[0],
			title: string,
		) =>
			tx.expense.create({
				data: { ...base, userId: user.id, title, amount: "1" },
				select: { id: true },
			});
		let slowId = "";
		// A starts first and stays open; B starts later and commits first.
		const slow = userTransaction(adminDb, user.id, async (tx) => {
			slowId = (await insert(tx, "slow")).id;
			opened();
			await gate;
		});
		await hasOpened;
		const fastId = (
			await userTransaction(adminDb, user.id, (tx) => insert(tx, "fast"))
		).id;

		// B is committed but A is open: nothing is shown, so no cursor passes A.
		expect((await pull(user.id)).items).toEqual([]);

		release();
		await slow;
		const seen = await until(
			() => pull(user.id, { limit: 2 }),
			(p) => p.items.length === 2,
		);
		expect(seen.items.map((r) => r.id)).toEqual([slowId, fastId]);
		// Resuming from the first stamp still finds the second.
		const one = await pull(user.id, { limit: 1 });
		expect(one.items.map((r) => r.id)).toEqual([slowId]);
		const resumed = await until(
			() => pull(user.id, { since: one.cursor, limit: 1 }),
			(p) => p.items.length === 1,
		);
		expect(resumed.items.map((r) => r.id)).toEqual([fastId]);
	}, 60_000);

	it("another user's open write holds back this user's newer commit, then both arrive in order", async () => {
		const mine = await createTestUser();
		const theirs = await createTestUser();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let opened: () => void = () => undefined;
		const hasOpened = new Promise<void>((r) => {
			opened = r;
		});
		const open = userTransaction(adminDb, theirs.user.id, async (tx) => {
			await tx.expense.create({
				data: { ...base, userId: theirs.user.id, amount: "1" },
			});
			opened();
			await gate;
		});
		await hasOpened;
		const [id] = await expenses(mine.user.id, 1);
		expect((await pull(mine.user.id)).items).toEqual([]);
		release();
		await open;
		const after = await until(
			() => pull(mine.user.id),
			(p) => p.items.length === 1,
		);
		expect(after.items[0]?.id).toBe(id);
	}, 60_000);

	it("a row updated between the stamp read and the row read comes back newer, and again on the next page", async () => {
		const { user } = await createTestUser();
		const [id] = await expenses(user.id, 1, "10");
		await until(
			() => pull(user.id),
			(p) => p.items.length === 1,
		);
		const page = await userTransaction(adminDb, user.id, async (tx) => {
			const read = await readStamps(tx, user.id, "expense", { limit: 500 });
			expect(read.stamps.map((s) => s.id)).toEqual([id]);
			// Another transaction commits between the two reads.
			await adminDb.expense.update({ where: { id }, data: { amount: "250" } });
			return loadPage(tx, user.id, "expense", read);
		});
		expect(page.items.map((r) => [r.id, r.amount.toString()])).toEqual([
			[id, "250"],
		]);
		expect(page.tombstones).toEqual([]);
		// Its newer stamp is past the page's cursor: it is delivered again.
		const next = await until(
			() => pull(user.id, { since: page.cursor, limit: 500 }),
			(p) => p.items.length === 1,
		);
		expect(next.items.map((r) => [r.id, r.amount.toString()])).toEqual([
			[id, "250"],
		]);
	});

	it("a row deleted between the two reads is a tombstone now, and its D stamp comes again later", async () => {
		const { user } = await createTestUser();
		const [id] = await expenses(user.id, 1);
		await until(
			() => pull(user.id),
			(p) => p.items.length === 1,
		);
		const page = await userTransaction(adminDb, user.id, async (tx) => {
			const read = await readStamps(tx, user.id, "expense", { limit: 500 });
			await adminDb.expense.delete({ where: { id } });
			return loadPage(tx, user.id, "expense", read);
		});
		expect(page.items).toEqual([]);
		expect(page.tombstones.map((t) => t.id)).toEqual([id]);
		const next = await until(
			() => pull(user.id, { since: page.cursor, limit: 500 }),
			(p) => p.tombstones.length === 1,
		);
		expect(next.tombstones.map((t) => t.id)).toEqual([id]);
		expect(next.items).toEqual([]);
	});
});

describe("cursors the log cannot honor", () => {
	const token = (e: string, t: string, s: string) => encodeCursor({ e, t, s });

	it("answers garbage with a bad cursor and a wrong shape the same way", async () => {
		const { user } = await createTestUser();
		await expect(
			pull(user.id, { since: "not-a-cursor", limit: 10 }),
		).rejects.toBeInstanceOf(InvalidCursorError);
		await expect(
			pull(user.id, { since: encodeCursor({ e: 1 }), limit: 10 }),
		).rejects.toBeInstanceOf(InvalidCursorError);
		await expect(
			pull(user.id, { since: token("x", "-1", "0"), limit: 10 }),
		).rejects.toBeInstanceOf(InvalidCursorError);
		// Numbers that fit the pattern but not the column are refused before SQL
		// casts them (a 500 otherwise).
		for (const [t, s] of [
			["18446744073709551616", "0"],
			["1", "9223372036854775808"],
			["99999999999999999999", "0"],
		] as const)
			await expect(
				pull(user.id, { since: token("x", t, s), limit: 10 }),
			).rejects.toBeInstanceOf(InvalidCursorError);
	});

	it("asks for a reset on another epoch", async () => {
		const { user } = await createTestUser();
		const [first] = await expenses(user.id, 1);
		const page = await until(
			() => pull(user.id),
			(p) => p.items.length === 1,
		);
		expect(first).toBeDefined();
		const real = JSON.parse(Buffer.from(page.cursor, "base64url").toString());
		await expect(
			pull(user.id, {
				since: token("another-epoch", real.t, real.s),
				limit: 10,
			}),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
		// The real one is fine.
		await expect(
			pull(user.id, { since: page.cursor, limit: 10 }),
		).resolves.toMatchObject({ items: [], hasMore: false });
	});

	it("asks for a reset on a txid this cluster has not reached", async () => {
		const { user } = await createTestUser();
		const [state] = await adminDb.$queryRaw<{ epoch: string; xmax: string }[]>`
			SELECT "epoch", pg_snapshot_xmax(pg_current_snapshot())::text AS "xmax" FROM "sync_state"`;
		const future = (BigInt(state?.xmax ?? 0) + 1_000_000n).toString();
		await expect(
			pull(user.id, {
				since: token(state?.epoch ?? "", future, "1"),
				limit: 10,
			}),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
	});

	it("the sweep removes old tombstones, raises the floor to the highest removed txid and keeps live and young stamps", async () => {
		const { user } = await createTestUser();
		const [old, young, live] = await expenses(user.id, 3);
		await until(
			() => pull(user.id),
			(p) => p.items.length === 3,
		);
		const held = (await pull(user.id, { limit: 500 })).cursor;
		await adminDb.expense.delete({ where: { id: old } });
		await adminDb.expense.delete({ where: { id: young } });
		const stamps = await stampsOf(user.id, "expense");
		const oldStamp = stamps.find((s) => s.entityId === old);
		expect(oldStamp?.op).toBe("D");
		// 100 days old against a 90-day cutoff; the other stays a day old.
		await adminDb.$executeRaw`UPDATE "sync_change" SET "changedAt" = now() - interval '100 days' WHERE "entity" = 'expense' AND "entityId" = ${old}`;
		await adminDb.$executeRaw`UPDATE "sync_change" SET "changedAt" = now() - interval '1 day' WHERE "entity" = 'expense' AND "entityId" = ${young}`;

		const removed = await sweepSyncTombstones(new Date(), 90);
		expect(removed).toBeGreaterThanOrEqual(1);
		const left = (await stampsOf(user.id, "expense"))
			.map((s) => `${s.entityId}:${s.op}`)
			.sort();
		expect(left).toEqual([`${live}:U`, `${young}:D`].sort());
		const [state] = await adminDb.$queryRaw<{ floor: string }[]>`
			SELECT "floorTxid"::text AS "floor" FROM "sync_state"`;
		expect(BigInt(state?.floor ?? 0)).toBeGreaterThanOrEqual(
			BigInt(oldStamp?.txid ?? 0),
		);

		// A cursor from before the sweep may have missed the old tombstone.
		await expect(
			pull(user.id, { since: held, limit: 10 }),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
		// A pull from the start is answered, and its cursor is honored (the cut
		// is past the floor once the cluster's older transactions are done).
		const fresh = await until(
			() => pull(user.id),
			(p) => p.items.length + p.tombstones.length === 2,
		);
		expect(fresh.items.map((r) => r.id)).toEqual([live]);
		expect(fresh.tombstones.map((t) => t.id)).toEqual([young]);
		await expect(caughtUp(user.id)).resolves.toBe(true);
	}, 60_000);

	it("a client whose newest stamp is older than the floor is not sent back to the start on every pull", async () => {
		const quiet = await createTestUser();
		const busy = await createTestUser();
		await expenses(quiet.user.id, 1);
		const [gone] = await expenses(busy.user.id, 1);
		await adminDb.expense.delete({ where: { id: gone } });
		await adminDb.$executeRaw`UPDATE "sync_change" SET "changedAt" = now() - interval '100 days' WHERE "entity" = 'expense' AND "entityId" = ${gone}`;
		await sweepSyncTombstones(new Date(), 90);
		// The floor is now above the quiet user's only stamp.
		const stamps = await stampsOf(quiet.user.id, "expense");
		const [state] = await adminDb.$queryRaw<{ floor: string }[]>`
			SELECT "floorTxid"::text AS "floor" FROM "sync_state"`;
		expect(BigInt(state?.floor ?? 0)).toBeGreaterThan(
			BigInt(stamps[0]?.txid ?? 0),
		);
		await expect(caughtUp(quiet.user.id)).resolves.toBe(true);
	}, 60_000);

	it("a cursor at the floor itself is refused (<=, not <)", async () => {
		const { user } = await createTestUser();
		const [id] = await expenses(user.id, 1);
		await adminDb.expense.delete({ where: { id } });
		const [stamp] = await stampsOf(user.id, "expense");
		await adminDb.$executeRaw`UPDATE "sync_change" SET "changedAt" = now() - interval '100 days' WHERE "entity" = 'expense' AND "entityId" = ${id}`;
		await sweepSyncTombstones(new Date(), 90);
		const [state] = await adminDb.$queryRaw<
			{ epoch: string }[]
		>`SELECT "epoch" FROM "sync_state"`;
		await expect(
			pull(user.id, {
				since: token(state?.epoch ?? "", stamp?.txid ?? "0", stamp?.seq ?? "0"),
				limit: 10,
			}),
		).rejects.toBeInstanceOf(SyncResetRequiredError);
	});
});

describe("isolation", () => {
	it("B sees none of A's stamps, rows or tombstones, even with A's cursor", async () => {
		const a = await createTestUser();
		const b = await createTestUser();
		const [keep, gone] = await expenses(a.user.id, 2);
		const mine = await expenses(b.user.id, 1);
		const aPage = await until(
			() => pull(a.user.id),
			(p) => p.items.length === 2,
		);
		await adminDb.expense.delete({ where: { id: gone } });
		await until(
			() => pull(a.user.id, { since: aPage.cursor, limit: 500 }),
			(p) => p.tombstones.length === 1,
		);

		const bPage = await until(
			() => pull(b.user.id),
			(p) => p.items.length === 1,
		);
		expect(bPage.items.map((r) => r.id)).toEqual(mine);
		expect(bPage.tombstones).toEqual([]);
		// A's cursor in B's hands reads B's log only.
		const withA = await pull(b.user.id, { since: aPage.cursor, limit: 500 });
		const seen = [
			...withA.items.map((r) => r.id),
			...withA.tombstones.map((t) => t.id),
		];
		expect(seen).not.toContain(keep);
		expect(seen).not.toContain(gone);

		// Under B's row-level security, A's stamps are not there, and the app
		// role cannot write the log.
		const visible = await userTransaction(
			adminDb,
			b.user.id,
			(tx) =>
				tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "sync_change"`,
		);
		expect(new Set(visible.map((r) => r.userId))).toEqual(new Set([b.user.id]));
		const denied = /permission denied for table sync_change/;
		for (const write of [
			(tx: Parameters<Parameters<typeof userTransaction>[2]>[0]) =>
				tx.$executeRaw`INSERT INTO "sync_change" ("entity","entityId","userId","op","seq") VALUES ('expense','x',${b.user.id},'U',1)`,
			(tx: Parameters<Parameters<typeof userTransaction>[2]>[0]) =>
				tx.$executeRaw`UPDATE "sync_change" SET "op" = 'D'`,
			(tx: Parameters<Parameters<typeof userTransaction>[2]>[0]) =>
				tx.$executeRaw`DELETE FROM "sync_change"`,
		])
			await expect(userTransaction(adminDb, b.user.id, write)).rejects.toThrow(
				denied,
			);
	});

	it("a row that changed hands is a tombstone for the old owner and a row for the new one", async () => {
		const a = await createTestUser();
		const b = await createTestUser();
		const [id] = await expenses(a.user.id, 1);
		await until(
			() => pull(a.user.id),
			(p) => p.items.length === 1,
		);
		// User text is sealed under its owner's key (in the sealed run), so a
		// real hand-over writes it again for the new owner, as here.
		await adminDb.$executeRaw`UPDATE "expense" SET "userId" = ${b.user.id}, "description" = NULL, "location" = NULL WHERE "id" = ${id}`;
		await fixtureDb.expense.update({
			where: { id },
			data: { title: "moved" },
			select: { id: true },
		});
		const forA = await until(
			() => pull(a.user.id),
			(p) => p.tombstones.length === 1,
		);
		expect(forA.items).toEqual([]);
		expect(forA.tombstones.map((t) => t.id)).toEqual([id]);
		const forB = await until(
			() => pull(b.user.id),
			(p) => p.items.length === 1,
		);
		expect(forB.items.map((r) => r.id)).toEqual([id]);
	});
});
