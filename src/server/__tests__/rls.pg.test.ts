/**
 * RLS on a real Postgres: the policies from 20260303000001_security_rls,
 * reached through createUserScopedDb exactly as protectedProcedure does.
 * db.test.ts only checks that the mechanism calls set_config. Which tables
 * the app role may read or write is pinned by
 * src/test/migrations/privileges.pg.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	createTestUser,
	FOREIGN_OWNER,
	fixtureDb,
	sealedSuite,
} from "~/test/pg-harness";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe("category RLS through createUserScopedDb", () => {
	let alice: TestUser;
	let bob: TestUser;
	let bobCategoryId: string;

	beforeAll(async () => {
		alice = await createTestUser();
		bob = await createTestUser();
		await fixtureDb.category.create({
			data: { name: "Groceries", color: "emerald", userId: alice.user.id },
		});
		const bobCategory = await fixtureDb.category.create({
			data: { name: "Rent", color: "blue", userId: bob.user.id },
		});
		bobCategoryId = bobCategory.id;
	});

	it("lists only the viewer's own rows", async () => {
		const aliceRows = await alice.db.category.findMany();
		const bobRows = await bob.db.category.findMany();

		expect(aliceRows.map((c) => c.name)).toEqual(["Groceries"]);
		expect(bobRows.map((c) => c.name)).toEqual(["Rent"]);
	});

	it("hides another user's row even when asked for it by id", async () => {
		await expect(
			alice.db.category.findUnique({ where: { id: bobCategoryId } }),
		).resolves.toBeNull();
	});

	it("cannot change or delete another user's row", async () => {
		// A column with no text: a bulk write may not set sealed text.
		const updated = await alice.db.category.updateMany({
			where: { id: bobCategoryId },
			data: { color: "red" },
		});
		const deleted = await alice.db.category.deleteMany({
			where: { id: bobCategoryId },
		});

		expect(updated.count).toBe(0);
		expect(deleted.count).toBe(0);
		await expect(
			fixtureDb.category.findUnique({ where: { id: bobCategoryId } }),
		).resolves.toMatchObject({ name: "Rent", userId: bob.user.id });
	});

	it("cannot create a row owned by another user", async () => {
		await expect(
			alice.db.category.create({
				data: { name: "Planted", color: "pink", userId: bob.user.id },
			}),
		).rejects.toThrow(sealedSuite ? FOREIGN_OWNER : /row-level security/);
	});

	it("leaves the admin client unscoped", async () => {
		const names = await fixtureDb.category.findMany({
			where: { userId: { in: [alice.user.id, bob.user.id] } },
		});
		// Sorted here: names may be sealed.
		expect(names.map((c) => c.name).sort()).toEqual(["Groceries", "Rent"]);
	});
});
