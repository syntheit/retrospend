/**
 * RLS on a real Postgres: the policies from 20260303000001_security_rls,
 * reached through createUserScopedDb exactly as protectedProcedure does.
 * db.test.ts only checks that the mechanism calls set_config.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe("category RLS through createUserScopedDb", () => {
	let alice: TestUser;
	let bob: TestUser;
	let bobCategoryId: string;

	beforeAll(async () => {
		alice = await createTestUser();
		bob = await createTestUser();
		await adminDb.category.create({
			data: { name: "Groceries", color: "emerald", userId: alice.user.id },
		});
		const bobCategory = await adminDb.category.create({
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
		const updated = await alice.db.category.updateMany({
			where: { id: bobCategoryId },
			data: { name: "Hijacked" },
		});
		const deleted = await alice.db.category.deleteMany({
			where: { id: bobCategoryId },
		});

		expect(updated.count).toBe(0);
		expect(deleted.count).toBe(0);
		await expect(
			adminDb.category.findUnique({ where: { id: bobCategoryId } }),
		).resolves.toMatchObject({ name: "Rent", userId: bob.user.id });
	});

	it("cannot create a row owned by another user", async () => {
		await expect(
			alice.db.category.create({
				data: { name: "Planted", color: "pink", userId: bob.user.id },
			}),
		).rejects.toThrow(/row-level security/);
	});

	it("leaves the admin client unscoped", async () => {
		const names = await adminDb.category.findMany({
			where: { userId: { in: [alice.user.id, bob.user.id] } },
			orderBy: { name: "asc" },
		});
		expect(names.map((c) => c.name)).toEqual(["Groceries", "Rent"]);
	});
});

describe("tables the app role may only read", () => {
	// Writes here go through the owner connection only (settings service,
	// auth procedures, the sidecar). See 20261022130001_revoke_app_writes.
	for (const table of [
		"app_settings",
		"exchange_rate",
		"password_reset_token",
	]) {
		it(`${table} is SELECT only for retrospend_app`, async () => {
			const rows = await adminDb.$queryRaw<
				{ privilege: string; granted: boolean }[]
			>`SELECT p AS privilege, has_table_privilege('retrospend_app', ${table}, p) AS granted
			  FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p`;

			expect(
				Object.fromEntries(rows.map((r) => [r.privilege, r.granted])),
			).toEqual({ SELECT: true, INSERT: false, UPDATE: false, DELETE: false });
		});
	}
});
