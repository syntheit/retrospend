/**
 * What the writers do to category.version (M3 PR1a): updateCategory's SQL
 * increment for a rename, the trigger for color, icon and excludeByDefault,
 * merge and its undo, the default-category script, and the web's save.
 * The trigger's own rules (columns, lowering, nulls) are in
 * src/test/migrations/category-version.pg.test.ts.
 *
 * Hand-derived: a new category is version 0. A rename is one bump. A rename
 * with a color change in the same update is one bump. Two renames at once end
 * at 2 with the answers 1 and 2. A merge never touches the target row. A
 * restore puts the category back at the version its stash holds (v3), or at
 * 1,000,000 when the stash predates the column (v2).
 */
import { LEGACY_STASH_CATEGORY_VERSION } from "@retrospend/domain/category-version";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categoriesRouter } from "~/server/api/routers/categories";
import { createCallerFactory } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import {
	putUndoStash,
	takeUndoStash,
} from "~/server/services/entry/undo-stash";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { migrateUserCategories } from "../../../../scripts/migrate-default-categories";
import { createCategory, updateCategory } from "../category.service";
import { arsUser, category, run, undo } from "./__tests__/merge-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const versionOf = async (id: string) =>
	(await adminDb.category.findUniqueOrThrow({ where: { id } })).version;

const trpcOf = (who: TestUser) =>
	createCallerFactory(categoriesRouter)({
		session: makeSession({ id: who.user.id }),
		db: who.db,
		headers: new Headers(),
	});

describe("updateCategory", () => {
	let who: TestUser;
	beforeAll(async () => {
		who = await createTestUser();
	});
	const fresh = (name: string, extra = {}) =>
		createCategory(who.db, who.user.id, { name, color: "teal", ...extra });
	const edit = (id: string, changes: Parameters<typeof updateCategory>[3]) =>
		updateCategory(who.db, who.user.id, id, changes);

	it("a new category is version 0, in the answer and the row", async () => {
		const made = await fresh("Zero");
		expect(made.version).toBe(0);
		expect(await versionOf(made.id)).toBe(0);
	});

	it("a rename bumps once, and a second rename once more", async () => {
		const made = await fresh("Before");
		expect((await edit(made.id, { name: "After" })).version).toBe(1);
		expect((await edit(made.id, { name: "After again" })).version).toBe(2);
		expect(await versionOf(made.id)).toBe(2);
	});

	it("color, icon and excludeByDefault each bump once through the trigger", async () => {
		const made = await fresh("Fields");
		expect((await edit(made.id, { color: "rose" })).version).toBe(1);
		expect((await edit(made.id, { icon: "house" })).version).toBe(2);
		expect((await edit(made.id, { excludeByDefault: true })).version).toBe(3);
		// The same values again are no change.
		expect(
			(
				await edit(made.id, {
					color: "rose",
					icon: "house",
					excludeByDefault: true,
				})
			).version,
		).toBe(3);
	});

	it("a rename with a color change in one update is one bump, not two", async () => {
		const made = await fresh("Both");
		const done = await edit(made.id, { name: "Both renamed", color: "rose" });
		expect(done.version).toBe(1);
		expect(await versionOf(made.id)).toBe(1);
	});

	it("a rename to the same name is still a rename: the service never compares names", async () => {
		const made = await fresh("Same");
		expect((await edit(made.id, { name: "Same" })).version).toBe(1);
	});

	it("two renames at once get two versions, 1 and 2, and the row ends at 2", async () => {
		const made = await fresh("Race");
		const answers = await Promise.all([
			edit(made.id, { name: "Race A" }),
			edit(made.id, { name: "Race B" }),
		]);
		expect(answers.map((a) => a.version).sort()).toEqual([1, 2]);
		expect(await versionOf(made.id)).toBe(2);
	});
});

describe("the web's save (categories.update)", () => {
	let who: TestUser;
	beforeAll(async () => {
		who = await createTestUser();
	});

	it("a save that changes nothing, name left out, leaves the version", async () => {
		const made = await createCategory(who.db, who.user.id, {
			name: "Quiet",
			color: "teal",
			icon: "house",
			excludeByDefault: true,
		});
		const done = await trpcOf(who).update({
			id: made.id,
			color: "teal",
			icon: "house",
			excludeByDefault: true,
		});
		expect(done.version).toBe(0);
		expect(await versionOf(made.id)).toBe(0);
	});

	it("takes name and color optional, and a name sent is a rename", async () => {
		const made = await createCategory(who.db, who.user.id, {
			name: "Named",
			color: "teal",
		});
		const api = trpcOf(who);
		expect(
			(await api.update({ id: made.id, excludeByDefault: true })).version,
		).toBe(1);
		expect((await api.update({ id: made.id, color: "rose" })).version).toBe(2);
		expect((await api.update({ id: made.id, name: "Renamed" })).version).toBe(
			3,
		);
		await expect(
			api.update({ id: made.id, icon: null } as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("default-category script", () => {
	it("a color fix moves the version, so a pending device edit parks", async () => {
		const { user } = await createTestUser();
		const taxes = await fixtureDb.category.create({
			data: { userId: user.id, name: "Taxes", color: "red" },
		});
		const actions = await migrateUserCategories(user.id);
		expect(actions.colorFixes).toEqual(["Taxes: red → slate"]);
		expect(await versionOf(taxes.id)).toBe(1);
		// A second run has nothing to fix and leaves it.
		await migrateUserCategories(user.id);
		expect(await versionOf(taxes.id)).toBe(1);
	});

	it("a script rename bumps once, so a device edit queued against the old version parks", async () => {
		const { user } = await createTestUser();
		const dining = await fixtureDb.category.create({
			data: { userId: user.id, name: "Dining Out", color: "orange" },
		});
		const actions = await migrateUserCategories(user.id);
		expect(actions.renames).toEqual(["Dining Out → Restaurants"]);
		expect(await versionOf(dining.id)).toBe(1);
		// A second run has nothing to rename and leaves it.
		await migrateUserCategories(user.id);
		expect(await versionOf(dining.id)).toBe(1);
	});
});

describe("delete, merge and the undo", () => {
	let me: string;
	beforeAll(async () => {
		me = await arsUser();
	});

	it("a merge leaves the target's version where it was", async () => {
		const target = await category(me, "Target");
		const source = await category(me, "Source");
		await adminDb.category.update({
			where: { id: target.id },
			data: { color: "rose" },
		});
		expect(await versionOf(target.id)).toBe(1);
		await run(me, source.id, target.id);
		expect(await versionOf(target.id)).toBe(1);
		expect(await adminDb.category.count({ where: { id: source.id } })).toBe(0);
	});

	it("delete then restore keeps the version the category held", async () => {
		const made = await category(me, "Held");
		await adminDb.category.update({
			where: { id: made.id },
			data: { color: "rose" },
		});
		await adminDb.category.update({
			where: { id: made.id },
			data: { icon: "house" },
		});
		expect(await versionOf(made.id)).toBe(2);
		const deleted = await run(me, made.id, null);
		await undo(me, deleted.value.stash);
		expect(await versionOf(made.id)).toBe(2);
		// The restore is an insert: the next change is the one after the held version.
		await adminDb.category.update({
			where: { id: made.id },
			data: { excludeByDefault: true },
		});
		expect(await versionOf(made.id)).toBe(3);
	});

	it("delete, restore, delete, restore keeps it again: a restored row carries its version into the next stash", async () => {
		const made = await category(me, "Twice");
		await adminDb.category.update({
			where: { id: made.id },
			data: { color: "rose" },
		});
		const first = await run(me, made.id, null);
		await undo(me, first.value.stash);
		const second = await run(me, made.id, null);
		await undo(me, second.value.stash);
		expect(await versionOf(made.id)).toBe(1);
	});

	it("a v2 stash, written before the column, restores at 1,000,000", async () => {
		const made = await category(me, "Legacy");
		const deleted = await run(me, made.id, null);
		// Rewrite the stash as v2 wrote it: no version on the category.
		const legacy = await userTransaction(adminDb, me, async (tx) => {
			const body = await takeUndoStash<{
				v: number;
				category: Record<string, unknown>;
			}>(tx, me, deleted.value.stash);
			expect(body.v).toBe(3);
			const { version: _held, ...old } = body.category;
			return putUndoStash(tx, me, { ...body, v: 2, category: old });
		});
		await undo(me, legacy);
		expect(await versionOf(made.id)).toBe(LEGACY_STASH_CATEGORY_VERSION);
		expect(LEGACY_STASH_CATEGORY_VERSION).toBe(1_000_000);
	});

	it("a v3 stash without an integer version is refused, and nothing comes back", async () => {
		const made = await category(me, "Broken");
		const deleted = await run(me, made.id, null);
		const broken = await userTransaction(adminDb, me, async (tx) => {
			const body = await takeUndoStash<{
				category: Record<string, unknown>;
			}>(tx, me, deleted.value.stash);
			const { version: _held, ...old } = body.category;
			return putUndoStash(tx, me, { ...body, category: old });
		});
		await expect(undo(me, broken)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(await adminDb.category.count({ where: { id: made.id } })).toBe(0);
	});
});
