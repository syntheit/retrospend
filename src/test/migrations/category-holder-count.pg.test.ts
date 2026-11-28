/**
 * Migration 20261127400000_category_holder_count: category_holder_count, the
 * definer function the undo of a category create counts foreign-key holders
 * with. The catalog and the behavior are read from the database; the rollback
 * runs twice, then the migration applies again, and neither touches the
 * category migrations before it.
 *
 * Hand-derived: a seeded row under each holder id is counted as 1, so a
 * holder missing from the function reads as 0 or NULL and fails here. The ids
 * come from the domain's CATEGORY_HOLDERS, never a copy.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CATEGORY_HOLDERS,
	type Holder,
} from "@retrospend/domain/category-merge/holders";
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { ForeignKeyHolderId } from "~/server/services/category/holder";
import { userTransaction } from "~/server/db-tx";
import { setupInput } from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261127400000_category_holder_count";
const EARLIER = [
	"20261127200000_category_version",
	"20261127300000_category_owner_policy",
];
const COUNT = (id: string, holder: string) =>
	`SELECT category_holder_count('${id}', '${holder}') AS n`;

type Q = {
	query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
};

describe("category_holder_count in the catalog", () => {
	it("is a definer function that pins its search_path, and only retrospend_app (not PUBLIC) executes it", async () => {
		const [fn] = await adminDb.$queryRaw<
			{
				definer: boolean;
				config: string[] | null;
				app: boolean;
				publicExecute: boolean;
			}[]
		>`
			SELECT p.prosecdef AS definer, p.proconfig AS config,
			       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS app,
			       (p.proacl IS NULL OR EXISTS (
			         SELECT 1 FROM aclexplode(p.proacl) a
			         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS "publicExecute"
			FROM pg_proc p
			WHERE p.proname = 'category_holder_count' AND p.pronamespace = 'public'::regnamespace`;
		expect(fn?.definer).toBe(true);
		expect(fn?.config?.some((c) => /^search_path=.*pg_temp$/.test(c))).toBe(
			true,
		);
		expect(fn?.app).toBe(true);
		expect(fn?.publicExecute).toBe(false);
	});
});

/** The two categories the book's setup links, made for this user. */
async function namedCategories(userId: string) {
	const make = (name: string) =>
		fixtureDb.category
			.create({ data: { name, color: "blue", userId } })
			.then((c) => c.id);
	return { rent: await make("Rent"), dining: await make("Dining") };
}

/** One row under each foreign-key holder, put in with the owner connection, naming the category. */
async function seedHolders(owner: string, categoryId: string) {
	const other = (await createTestUser()).user.id;
	const tx = await fixtureDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "30",
			currency: "USD",
			date: new Date("2026-10-14T20:00:00Z"),
			categoryId,
			paidByType: "user",
			paidById: other,
			createdByType: "user",
			createdById: other,
		},
	});
	await forUser(owner).apply(setupEnvelopeBook, {
		...setupInput(await namedCategories(owner)),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: owner },
		include: { envelopes: true },
	});
	const envelope = book.envelopes[0] as { id: string };
	const seeds: Record<ForeignKeyHolderId, () => Promise<unknown>> = {
		expense: () =>
			fixtureDb.expense.create({
				data: {
					userId: owner,
					title: "x",
					amount: "1",
					currency: "ARS",
					date: new Date(),
					categoryId,
					amountInUSD: "0.001",
					exchangeRate: "1",
					pricingSource: "MANUAL",
				},
			}),
		template: () =>
			fixtureDb.recurringTemplate.create({
				data: {
					userId: owner,
					name: "Gym",
					amount: "20",
					categoryId,
					frequency: "MONTHLY",
					nextDueDate: new Date("2026-12-01T00:00:00Z"),
				},
			}),
		sharedTransaction: async () => tx,
		share: () =>
			fixtureDb.splitParticipant.create({
				data: {
					transactionId: tx.id,
					participantType: "user",
					participantId: other,
					shareAmount: "15",
					categoryId,
					categorySource: "USER",
				},
			}),
		budget: () =>
			fixtureDb.budget.create({
				data: {
					userId: owner,
					categoryId,
					period: new Date("2026-11-01T00:00:00Z"),
					amount: "5",
				},
			}),
		envelopeLink: () =>
			fixtureDb.envelopeCategory.create({
				data: { bookId: book.id, envelopeId: envelope.id, categoryId },
			}),
		preference: () =>
			fixtureDb.analyticsCategoryPreference.create({
				data: { userId: owner, categoryId, isFlexible: true },
			}),
	};
	for (const holder of CATEGORY_HOLDERS as readonly Holder[])
		await seeds[holder.id as ForeignKeyHolderId]();
}

describe("category_holder_count counts", () => {
	it("one row under each holder the domain lists, including rows the caller cannot read, and only for the caller's own category", async () => {
		const me = (await createTestUser()).user.id;
		const stranger = (await createTestUser()).user.id;
		const mine = await fixtureDb.category.create({
			data: { id: randomUUID(), name: "Mine", color: "teal", userId: me },
		});
		await seedHolders(me, mine.id);

		const asUser = <T>(userId: string, work: (tx: never) => Promise<T>) =>
			userTransaction(adminDb, userId, work as never) as Promise<T>;
		const countAs = (userId: string, holder: string) =>
			asUser(userId, async (tx) => {
				const t = tx as unknown as {
					$queryRawUnsafe: (sql: string) => Promise<{ n: bigint | null }[]>;
				};
				return (await t.$queryRawUnsafe(COUNT(mine.id, holder)))[0]?.n ?? null;
			});

		for (const holder of CATEGORY_HOLDERS)
			expect(await countAs(me, holder.id), holder.id).toBe(1n);
		// The caller cannot read the other person's shared expense, and it is counted.
		expect(
			await asUser(me, async (tx) =>
				(tx as unknown as typeof adminDb).sharedTransaction.count({
					where: { categoryId: mine.id },
				}),
			),
		).toBe(0);
		// Not the caller's category, an unknown holder: null, never 0.
		expect(await countAs(stranger, "expense")).toBeNull();
		expect(await countAs(me, "nothing")).toBeNull();
	});
});

describe("rollback of 20261127400000_category_holder_count", () => {
	const state = async (client: Q) => {
		const one = async (sql: string) =>
			(await client.query(sql)).rows[0]?.n as number;
		return {
			fn: await one(
				"SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'category_holder_count'",
			),
			record: await one(
				`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${NAME}'`,
			),
			earlier: await one(
				`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name IN (${EARLIER.map((e) => `'${e}'`).join(",")})`,
			),
		};
	};

	it("drops the function and its record, runs twice, leaves the category migrations, and the migration applies again", async () => {
		const rollback = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const seen: Record<string, Awaited<ReturnType<typeof state>>> = {};
		await inRolledBackTransaction(async (client) => {
			seen.migrated = await state(client);
			await client.query(rollback);
			seen.rolledBack = await state(client);
			await client.query(rollback);
			seen.twice = await state(client);
			await client.query(migration);
			seen.forward = await state(client);
			await client.query(migration);
			seen.forwardTwice = await state(client);
		});
		expect(seen.rolledBack).toEqual({ fn: 0, record: 0, earlier: 2 });
		expect(seen.twice).toEqual(seen.rolledBack);
		expect(seen.forward?.fn).toBe(1);
		expect(seen.forwardTwice).toEqual(seen.forward);
		expect(seen.migrated?.earlier).toBe(2);
	});
});
