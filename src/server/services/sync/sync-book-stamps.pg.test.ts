/**
 * The personal-book family of the delta log on real Postgres (E2EE lane P,
 * P14c): what lands in "sync_change" when the rows of a book are written,
 * changed and removed, who gets the stamps (the book's creator, while the book
 * is personal and alone), what happens when the book stops being personal
 * (Q4: tombstones to the creator, then silence, then stamps again if it
 * returns), the cascade of a book delete, account deletion, rollback, the
 * backfill and the catalog of triggers. Expectations are derived by hand from
 * the rows seedBook writes: 13 rows, one stamp each.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { readSchema } from "~/test/prisma-schema";
import { inRolledBackPrismaTransaction } from "~/test/rolled-back-sql";
import { BOOK_ID_COLUMN, SYNCED_BOOK_ENTITIES } from "./book-entities";
import {
	bookStamps,
	type SeededBook,
	seedBook,
	seededStamps,
} from "./sync-book-test-support";
import { stampOf, stampsOf } from "./sync-test-support";

const movementData = (s: SeededBook, userId: string, amount: string) => ({
	id: randomUUID(),
	bookId: s.book,
	month: 202611,
	toEnvelopeId: s.rent,
	amount,
	kind: "ASSIGN" as const,
	actorUserId: userId,
});

/** A book that is not personal: the rows of a household book. */
async function seedSharedBook(userId: string) {
	const book = await fixtureDb.budgetBook.create({
		data: {
			createdById: userId,
			isPersonal: false,
			name: "Household",
			currency: "ARS",
			startDate: new Date("2026-11-01T00:00:00.000Z"),
			startMonth: 202611,
		},
	});
	await fixtureDb.budgetMember.create({
		data: { bookId: book.id, userId, role: "OWNER" },
	});
	const envelope = await fixtureDb.envelope.create({
		data: { bookId: book.id, name: "Food", sortOrder: 1 },
	});
	await fixtureDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			month: 202611,
			toEnvelopeId: envelope.id,
			amount: "10",
			kind: "ASSIGN",
			actorUserId: userId,
		},
	});
	return book.id;
}

describe("a book's rows are stamped U when written", () => {
	it("one stamp per row in each of the twelve tables", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		expect(await bookStamps(user.id)).toEqual(seededStamps(s));
	});

	it("an app role write is stamped by the definer trigger, and an update moves the stamp forward", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		const before = await stampOf(user.id, "envelope", s.rent);
		const movement = movementData(s, user.id, "10.5");
		await userTransaction(adminDb, user.id, async (tx) => {
			await tx.budgetMovement.create({ data: movement });
			await tx.envelope.update({
				where: { id: s.rent },
				data: { sortOrder: 5 },
			});
			await tx.budgetBook.update({
				where: { id: s.book },
				data: { lastOpenedAt: new Date("2026-11-10T00:00:00.000Z") },
			});
		});
		expect((await stampOf(user.id, "budget_movement", movement.id))?.op).toBe(
			"U",
		);
		const after = await stampOf(user.id, "envelope", s.rent);
		expect(after?.op).toBe("U");
		expect(BigInt(after?.seq ?? 0)).toBeGreaterThan(BigInt(before?.seq ?? 0));
		const book = await stampOf(user.id, "budget_book", s.book);
		expect(book?.op).toBe("U");
	});

	it("an income rule run is stamped under its expense's id", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		const stamp = await stampOf(user.id, "income_rule_run", s.run);
		expect(stamp?.op).toBe("U");
		await fixtureDb.incomeRuleRun.update({
			where: { expenseId: s.run },
			data: { skipped: true },
		});
		const again = await stampOf(user.id, "income_rule_run", s.run);
		expect(BigInt(again?.seq ?? 0)).toBeGreaterThan(BigInt(stamp?.seq ?? 0));
	});

	it("2,000 movements in one statement are 2,000 stamps in one transaction", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		await fixtureDb.budgetMovement.createMany({
			data: Array.from({ length: 2_000 }, () => movementData(s, user.id, "1")),
		});
		const rows = await stampsOf(user.id, "budget_movement");
		// By hand: the seed's one movement and 2,000 more.
		expect(rows).toHaveLength(2_001);
		const bulk = rows.filter((r) => r.entityId !== s.movement);
		expect(new Set(bulk.map((r) => r.txid)).size).toBe(1);
		expect(new Set(bulk.map((r) => r.seq)).size).toBe(2_000);
	}, 60_000);

	it("another user's book never writes a stamp for this user", async () => {
		const mine = await createTestUser();
		const theirs = await createTestUser();
		const s = await seedBook(mine.user.id);
		const t = await seedBook(theirs.user.id);
		expect(await bookStamps(mine.user.id)).toEqual(seededStamps(s));
		expect(await bookStamps(theirs.user.id)).toEqual(seededStamps(t));
	});

	it("a book that is not personal is never stamped", async () => {
		const { user } = await createTestUser();
		await seedSharedBook(user.id);
		expect(await bookStamps(user.id)).toEqual([]);
	});
});

describe("a row is stamped D when it goes", () => {
	it("an envelope and its category link, by cascade, and a movement by a plain delete", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		await adminDb.envelope.delete({ where: { id: s.spare } });
		await adminDb.budgetMovement.delete({ where: { id: s.movement } });
		const expected = seededStamps(s).map((stamp) =>
			[
				`envelope:${s.spare}:U`,
				`envelope_category:${s.spareLink}:U`,
				`budget_movement:${s.movement}:U`,
			].includes(stamp)
				? stamp.replace(/:U$/, ":D")
				: stamp,
		);
		expect(await bookStamps(user.id)).toEqual(expected);
	});

	it("deleting the book turns every stamp of it, the book's and the eleven tables', into D", async () => {
		const { user } = await createTestUser();
		const other = await createTestUser();
		const s = await seedBook(user.id);
		const kept = await seedBook(other.user.id);
		await adminDb.budgetBook.delete({ where: { id: s.book } });
		expect(await bookStamps(user.id)).toEqual(seededStamps(s, "D"));
		expect(await adminDb.envelope.count({ where: { bookId: s.book } })).toBe(0);
		// Another user's book is untouched.
		expect(await bookStamps(other.user.id)).toEqual(seededStamps(kept));
	});

	it("a delete as the app role leaves the same tombstone", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		await userTransaction(adminDb, user.id, async (tx) => {
			await tx.envelopeCategory.delete({ where: { id: s.spareLink } });
		});
		expect((await stampOf(user.id, "envelope_category", s.spareLink))?.op).toBe(
			"D",
		);
	});
});

describe("a book that stops being personal (Q4)", () => {
	it("gaining a member hands every row to a tombstone, goes silent, and stamps again when the member leaves", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		const member = await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest.user.id, role: "EDITOR" },
		});
		expect(await bookStamps(owner.user.id)).toEqual(seededStamps(s, "D"));
		// The new member never held a stamp of the book.
		expect(await bookStamps(guest.user.id)).toEqual([]);
		const frozen = await stampsOf(owner.user.id);

		// While it is shared: changes, new rows and deletes write nothing.
		const movement = movementData(s, owner.user.id, "2");
		await fixtureDb.budgetMovement.create({ data: movement });
		await fixtureDb.envelope.update({
			where: { id: s.rent },
			data: { sortOrder: 9 },
		});
		await adminDb.envelope.delete({ where: { id: s.spare } });
		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { lastOpenedAt: new Date("2026-11-11T00:00:00.000Z") },
		});
		expect(await stampsOf(owner.user.id)).toEqual(frozen);
		expect(await bookStamps(guest.user.id)).toEqual([]);

		// Back to the creator alone: the rows that exist are U again, the one
		// deleted while shared stays a tombstone, the new movement is stamped.
		await adminDb.budgetMember.delete({ where: { id: member.id } });
		const back = new Set(await bookStamps(owner.user.id));
		const expected = new Set(
			seededStamps(s).map((stamp) =>
				stamp === `envelope:${s.spare}:U` ||
				stamp === `envelope_category:${s.spareLink}:U`
					? stamp.replace(/:U$/, ":D")
					: stamp,
			),
		);
		expected.add(`budget_movement:${movement.id}:U`);
		expect(back).toEqual(expected);
	});

	it("flipping isPersonal off writes tombstones for the whole book, and on again writes stamps", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { isPersonal: false },
		});
		expect(await bookStamps(user.id)).toEqual(seededStamps(s, "D"));
		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { isPersonal: true },
		});
		expect(await bookStamps(user.id)).toEqual(seededStamps(s));
	});

	it("a creator who already has a second member before the flip writes no new tombstones", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest.user.id, role: "VIEWER" },
		});
		const handed = await stampsOf(owner.user.id);
		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { isPersonal: false },
		});
		expect(await stampsOf(owner.user.id)).toEqual(handed);
	});

	it("deleting a shared book that was handed over adds nothing", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest.user.id, role: "EDITOR" },
		});
		const handed = await stampsOf(owner.user.id);
		await adminDb.budgetBook.delete({ where: { id: s.book } });
		expect(await stampsOf(owner.user.id)).toEqual(handed);
		expect(await bookStamps(owner.user.id)).toEqual(seededStamps(s, "D"));
	});

	it("a member's own account deletion does not disturb the creator's tombstones", async () => {
		const owner = await createTestUser();
		const guest = await createTestUser();
		const s = await seedBook(owner.user.id);
		await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest.user.id, role: "EDITOR" },
		});
		const handed = await stampsOf(owner.user.id);
		await adminDb.user.delete({ where: { id: guest.user.id } });
		// The member row went with the user: the book is the creator's alone
		// again, so its rows are stamped U once more.
		expect(await bookStamps(owner.user.id)).toEqual(seededStamps(s));
		expect(handed.length).toBeGreaterThan(0);
	});
});

describe("accounts and rollbacks", () => {
	it("deleting the user (anonymize and delete) leaves no stamps and fails nothing", async () => {
		const gone = await createTestUser();
		const stays = await createTestUser();
		const s = await seedBook(gone.user.id);
		const kept = await seedBook(stays.user.id);
		expect((await stampsOf(gone.user.id)).length).toBeGreaterThan(0);
		await anonymizeAndDeleteUser(adminDb, gone.user.id, gone.user.email, null);
		expect(await stampsOf(gone.user.id)).toEqual([]);
		expect(await adminDb.budgetBook.count({ where: { id: s.book } })).toBe(0);
		expect(await bookStamps(stays.user.id)).toEqual(seededStamps(kept));
	});

	it("deleting the user as the owner leaves no stamps, with the whole family and its cascades", async () => {
		const { user } = await createTestUser();
		await seedBook(user.id);
		await adminDb.user.delete({ where: { id: user.id } });
		expect(await stampsOf(user.id)).toEqual([]);
	});

	it("a rolled-back write leaves no stamp", async () => {
		const { user } = await createTestUser();
		const s = await seedBook(user.id);
		const movement = movementData(s, user.id, "7");
		await expect(
			userTransaction(adminDb, user.id, async (tx) => {
				await tx.budgetMovement.create({ data: movement });
				throw new Error("roll back");
			}),
		).rejects.toThrow("roll back");
		expect(await stampOf(user.id, "budget_movement", movement.id)).toBe(
			undefined,
		);
		expect(await bookStamps(user.id)).toEqual(seededStamps(s));
	});
});

describe("backfill", () => {
	it("stamps the rows of a personal book once, leaves a shared book and an existing stamp alone", async () => {
		const mine = await createTestUser();
		const shared = await createTestUser();
		const s = await seedBook(mine.user.id);
		await seedSharedBook(shared.user.id);
		const before = await bookStamps(mine.user.id);
		expect(before).toEqual(seededStamps(s));
		await adminDb.envelope.delete({ where: { id: s.spare } });
		const tombstone = await stampOf(mine.user.id, "envelope", s.spare);
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM "sync_change" WHERE "userId" IN (${mine.user.id}, ${shared.user.id}) AND "entity" <> 'envelope'`;
			const [first] = await tx.$queryRaw<
				{ n: number }[]
			>`SELECT sync_backfill()::int AS "n"`;
			// By hand: the seed has 13 rows; Spare and its category link are gone,
			// leaving 11; Rent's envelope kept its stamp, so 10 are stamped again.
			const added = await tx.$queryRaw<{ entity: string; userId: string }[]>`
				SELECT "entity", "userId" FROM "sync_change"
				WHERE "txid" = pg_current_xact_id_if_assigned()`;
			// The book's category (a row of the older log) was stamped again too.
			const family = new Set<string>(SYNCED_BOOK_ENTITIES);
			expect(
				added.filter((r) => r.userId === mine.user.id && family.has(r.entity)),
			).toHaveLength(10);
			expect(first?.n).toBe(added.length);
			const rows = await tx.$queryRaw<{ entity: string; op: string }[]>`
				SELECT "entity", "op" FROM "sync_change" WHERE "userId" = ${mine.user.id}`;
			expect(rows.every((r) => r.op === "U" || r.entity === "envelope")).toBe(
				true,
			);
			const [second] = await tx.$queryRaw<
				{ n: number }[]
			>`SELECT sync_backfill()::int AS "n"`;
			expect(second?.n).toBe(0);
			// The shared book's rows were not stamped by the run.
			const sharedRows = await tx.$queryRaw<{ n: number }[]>`
				SELECT count(*)::int AS "n" FROM "sync_change"
				WHERE "userId" = ${shared.user.id}
				  AND "entity" IN (SELECT "tbl" FROM sync_book_tables())`;
			expect(sharedRows[0]?.n).toBe(0);
			// An existing stamp, a tombstone included, is kept.
			const kept = await tx.$queryRaw<{ op: string; seq: string }[]>`
				SELECT "op", "seq"::text AS "seq" FROM "sync_change"
				WHERE "entity" = 'envelope' AND "entityId" = ${s.spare}`;
			expect(kept).toEqual([{ op: "D", seq: tombstone?.seq }]);
		});
	});
});

describe("trigger coverage", () => {
	type TriggerRow = {
		table: string;
		name: string;
		type: number;
		fn: string;
		args: string;
		enabled: string;
	};
	const triggers = () =>
		adminDb.$queryRawUnsafe<TriggerRow[]>(`
			SELECT c.relname AS "table", t.tgname AS "name", t.tgtype AS "type",
			       p.proname AS "fn",
			       replace(encode(t.tgargs, 'escape'), '\\000', ',') AS "args",
			       t.tgenabled::text AS "enabled"
			FROM pg_trigger t
			JOIN pg_class c ON c.oid = t.tgrelid
			JOIN pg_proc p ON p.oid = t.tgfoid
			WHERE p.proname IN ('sync_stamp_book_rows','sync_stamp_book_self','sync_stamp_book_members')
			  AND NOT t.tgisinternal
			ORDER BY c.relname, t.tgname`);

	it("the constant, the migration's table list and the id columns agree", async () => {
		const rows = await adminDb.$queryRaw<
			{ tbl: string; idcol: string; bookcol: string }[]
		>`SELECT "tbl", "idcol", "bookcol" FROM sync_book_tables()`;
		expect(rows.map((r) => r.tbl).sort()).toEqual(
			[...SYNCED_BOOK_ENTITIES].sort(),
		);
		for (const r of rows) {
			expect(r.idcol).toBe(BOOK_ID_COLUMN[r.tbl as never] ?? "id");
			expect(r.bookcol).toBe(r.tbl === "budget_book" ? "id" : "bookId");
		}
	});

	it("every table of the family has exactly its three statement triggers, after the write, and so has budget_member", async () => {
		const rows = await triggers();
		const byTable = new Map<string, TriggerRow[]>();
		for (const r of rows)
			byTable.set(r.table, [...(byTable.get(r.table) ?? []), r]);
		expect([...byTable.keys()].sort()).toEqual(
			[...SYNCED_BOOK_ENTITIES, "budget_member"].sort(),
		);
		for (const [table, list] of byTable) {
			expect(list.map((t) => t.name).sort()).toEqual(
				[`sync_${table}_del`, `sync_${table}_ins`, `sync_${table}_upd`].sort(),
			);
			const fn =
				table === "budget_book"
					? "sync_stamp_book_self"
					: table === "budget_member"
						? "sync_stamp_book_members"
						: "sync_stamp_book_rows";
			for (const t of list) {
				expect(t.fn).toBe(fn);
				if (fn === "sync_stamp_book_rows")
					expect(t.args.replace(/,$/, "")).toBe(
						`${table},${BOOK_ID_COLUMN[table as never] ?? "id"}`,
					);
				// tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
				expect(t.type & 1).toBe(0);
				expect(t.type & 2).toBe(0);
				expect(t.enabled).toBe("O");
			}
			expect(list.map((t) => t.type & 28).sort((x, y) => x - y)).toEqual([
				4, 8, 16,
			]);
		}
	});

	it("every Prisma model with a bookId is in the family or has a stated reason not to be", () => {
		const NOT_SYNCED: Record<string, string> = {
			budget_member:
				"membership decides who owns the rows; the book's tombstones carry the effect",
			budget_dirty: "derived cache, the device rebuilds it",
			budget_row_value: "derived cache, the device rebuilds it",
			budget_draft: "plan drafts are worked on the server (plan section 2)",
		};
		const tables = readSchema()
			.filter((m) => m.fields.some((f) => f.name === "bookId"))
			.map((m) => m.table);
		const family = SYNCED_BOOK_ENTITIES as readonly string[];
		expect(
			tables.filter((t) => !family.includes(t) && !(t in NOT_SYNCED)),
		).toEqual([]);
		expect(Object.keys(NOT_SYNCED).filter((t) => !tables.includes(t))).toEqual(
			[],
		);
		// The family is every model with a bookId that is not excluded, and the book.
		expect(
			family.filter((t) => t !== "budget_book" && !tables.includes(t)),
		).toEqual([]);
	});
});
