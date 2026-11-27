/**
 * M3 PR0: category create and edit as they behave today, over tRPC
 * (categories.create, categories.update) and /api/v1/categories (POST,
 * PATCH). Characterization only: every line pins what main does, including
 * what the device slice will change.
 *
 * Hand-derived:
 *   - A category row has a version (M3 PR1a, 0 when new) and no updatedAt: its
 *     columns are exactly id, name, nameIndex, color, icon, isFixed,
 *     excludeByDefault, kind, version, userId.
 *   - Two names are the same name when their trimmed text is equal, compared
 *     exactly: "Food" and "Food " are one name, "Food" and "food" are two.
 *   - The name index exists only with a master key (the sealed suite has one):
 *     "Food" and "Food " share one index, "food" has another, and the plain
 *     suite stores null.
 *   - teal is color slot 9, so a teal category's v1 tone is 9.
 */

import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { categoriesRouter } from "~/server/api/routers/categories";
import { createCallerFactory } from "~/server/api/trpc";
import {
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	fixtureDb,
} from "~/server/api/v1/core/__tests__/harness";
import { sealedSuite } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { createCategory, updateCategory } from "../category.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.categories;
type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type Dto = {
	id: string;
	name: string;
	color: string;
	icon: string | null;
	kind: string;
	tone: number;
	excludeByDefault: boolean;
	expenseCount: number;
	version: number;
};

const INDEX = /^[0-9a-f]{16}:[0-9a-f]{64}$/;
const TAKEN = {
	code: "CONFLICT",
	message: "Category name already exists",
};

const rowOf = (id: string) =>
	fixtureDb.category.findUniqueOrThrow({ where: { id } });

/** The caller of the web's categories router, as that user (RLS on). */
const trpcOf = (who: TestUser) =>
	createCallerFactory(categoriesRouter)({
		session: makeSession({ id: who.user.id }),
		db: who.db,
		headers: new Headers(),
	});

describe("create", () => {
	let who: TestUser;
	let as: Record<string, string>;
	beforeAll(async () => {
		who = await createTestUser();
		as = await asMobile(who.user.id);
	});

	const post = (body: unknown, key: string | true = true) =>
		call("/categories", {
			method: "POST",
			headers: as,
			body,
			idempotent: key,
		});

	it("tRPC answers the row without its count, makes a cuid and an EXPENSE category", async () => {
		const made = await trpcOf(who).create({ name: "Rent", color: "teal" });
		expect(made).toEqual({
			id: expect.any(String),
			name: "Rent",
			color: "teal",
			icon: null,
			kind: "EXPENSE",
			excludeByDefault: false,
			version: 0,
		});
		expect(z.cuid().safeParse(made.id).success).toBe(true);
		const row = await rowOf(made.id);
		// A version, no updatedAt: a category has no updated date.
		expect(Object.keys(row).sort()).toEqual([
			"color",
			"excludeByDefault",
			"icon",
			"id",
			"isFixed",
			"kind",
			"name",
			"nameIndex",
			"userId",
			"version",
		]);
		expect(row).toMatchObject({ isFixed: false, userId: who.user.id });
		if (sealedSuite) expect(row.nameIndex).toMatch(INDEX);
		else expect(row.nameIndex).toBeNull();
	});

	it("tRPC keeps the icon and excludeByDefault it is given, and cannot set the kind", async () => {
		const made = await trpcOf(who).create({
			name: "Salary-like",
			color: "emerald",
			icon: "house",
			excludeByDefault: true,
			// Not in the input schema: zod strips it.
			...({ kind: "INCOME" } as object),
		});
		expect(made).toMatchObject({
			icon: "house",
			excludeByDefault: true,
			kind: "EXPENSE",
		});
		expect(await rowOf(made.id)).toMatchObject({
			kind: "EXPENSE",
			icon: "house",
			excludeByDefault: true,
		});
	});

	it("v1 answers the dto with the tone and a zero count, and takes the server's id", async () => {
		const wanted = randomUUID();
		const made = await expectBody<Dto>(
			await post({
				name: "Utilities-like",
				color: "teal",
				icon: "bolt",
				excludeByDefault: true,
				// A client id and a kind are not part of today's contract.
				id: wanted,
				kind: "income",
			}),
			c.create,
			201,
		);
		expect(made).toEqual({
			id: expect.any(String),
			name: "Utilities-like",
			color: "teal",
			icon: "bolt",
			kind: "expense",
			tone: 9,
			excludeByDefault: true,
			expenseCount: 0,
			version: 0,
		});
		expect(made.id).not.toBe(wanted);
		expect(z.cuid().safeParse(made.id).success).toBe(true);
		expect(await rowOf(made.id)).toMatchObject({ kind: "EXPENSE" });
		await expect(
			fixtureDb.category.count({ where: { id: wanted } }),
		).resolves.toBe(0);
	});

	it("v1 replays a create with its key and writes once, and a new key is a new write", async () => {
		const key = randomUUID();
		const first = await post({ name: "Replayed", color: "blue" }, key);
		const second = await post({ name: "Replayed", color: "blue" }, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expectProblem(
			await post({ name: "Replayed", color: "blue" }),
			409,
			"conflict",
		);
	});

	it("sets the name index of the trimmed name, exact: Food and 'Food ' share one, food has another", async () => {
		const user = await createTestUser();
		const food = await createCategory(user.db, user.user.id, {
			name: "Food",
			color: "blue",
		});
		const lower = await createCategory(user.db, user.user.id, {
			name: "food",
			color: "blue",
		});
		const [a, b] = [await rowOf(food.id), await rowOf(lower.id)];
		if (!sealedSuite) {
			expect([a.nameIndex, b.nameIndex]).toEqual([null, null]);
			return;
		}
		expect(a.nameIndex).toMatch(INDEX);
		expect(b.nameIndex).toMatch(INDEX);
		expect(a.nameIndex).not.toBe(b.nameIndex);
		// "Food " would be the same index as "Food": the write is refused.
		await expect(
			createCategory(user.db, user.user.id, { name: "Food ", color: "blue" }),
		).rejects.toMatchObject(TAKEN);
	});

	it("tRPC and v1 refuse a blank name and control text before any write", async () => {
		const user = await createTestUser();
		const api = trpcOf(user);
		const asUser = await asMobile(user.user.id);
		for (const name of [" ", "   ", "\t \n", "Bad\u0001name"]) {
			await expect(api.create({ name, color: "teal" })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
			await expectProblem(
				await call("/categories", {
					method: "POST",
					headers: asUser,
					body: { name, color: "teal" },
					idempotent: true,
				}),
				400,
				"validation_failed",
			);
		}
		await expect(
			fixtureDb.category.count({ where: { userId: user.user.id } }),
		).resolves.toBe(0);
	});

	it("a name stays as typed: leading and trailing spaces are stored", async () => {
		const user = await createTestUser();
		const made = await trpcOf(user).create({ name: " Food ", color: "teal" });
		expect(made.name).toBe(" Food ");
		expect((await rowOf(made.id)).name).toBe(" Food ");
	});
});

describe("edit", () => {
	let who: TestUser;
	let as: Record<string, string>;
	beforeAll(async () => {
		who = await createTestUser();
		as = await asMobile(who.user.id);
	});

	const patch = (id: string, body: unknown) =>
		call(`/categories/${id}`, {
			method: "PATCH",
			headers: as,
			body,
			idempotent: true,
		});
	const fresh = (name: string, extra = {}) =>
		createCategory(who.db, who.user.id, { name, color: "teal", ...extra });

	it("tRPC changes name, color, icon and excludeByDefault, and never the kind", async () => {
		const made = await fresh("Before");
		const done = await trpcOf(who).update({
			id: made.id,
			name: "After",
			color: "rose",
			icon: "house",
			excludeByDefault: true,
			...({ kind: "INCOME" } as object),
		});
		expect(done).toEqual({
			id: made.id,
			name: "After",
			color: "rose",
			icon: "house",
			kind: "EXPENSE",
			excludeByDefault: true,
			// One bump for the rename and the three fields together.
			version: 1,
		});
		expect(await rowOf(made.id)).toMatchObject({
			name: "After",
			color: "rose",
			icon: "house",
			kind: "EXPENSE",
			excludeByDefault: true,
		});
	});

	it("tRPC takes a name or a color alone since M3 PR1a, and still cannot clear the icon", async () => {
		const made = await fresh("Needs neither", { icon: "house" });
		const api = trpcOf(who);
		await expect(
			api.update({
				id: made.id,
				name: "Needs neither",
				color: "teal",
				icon: null,
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		// A color alone: the name, icon and flag are kept as they were.
		await api.update({ id: made.id, color: "blue" });
		expect(await rowOf(made.id)).toMatchObject({
			name: "Needs neither",
			icon: "house",
			excludeByDefault: false,
			color: "blue",
		});
		// A name alone: the color is kept.
		await api.update({ id: made.id, name: "Only a name" });
		expect(await rowOf(made.id)).toMatchObject({
			name: "Only a name",
			color: "blue",
		});
	});

	it("v1 PATCH is partial: a flag alone leaves every other field, an empty body changes nothing", async () => {
		const made = await fresh("Partial", { icon: "house" });
		const before = await rowOf(made.id);
		const flagged = await expectBody<Dto>(
			await patch(made.id, { excludeByDefault: true }),
			c.update,
		);
		expect(flagged).toMatchObject({
			name: "Partial",
			color: "teal",
			icon: "house",
			excludeByDefault: true,
		});
		const empty = await expectBody<Dto>(await patch(made.id, {}), c.update);
		expect(empty).toEqual(flagged);
		expect(await rowOf(made.id)).toEqual({ ...before, excludeByDefault: true });
	});

	it("v1 PATCH removes the icon with null, and ignores a kind or an expectedVersion it is sent", async () => {
		const made = await fresh("Iconic", { icon: "house" });
		const done = await expectBody<Dto>(
			await patch(made.id, {
				icon: null,
				kind: "income",
				expectedVersion: 7,
			}),
			c.update,
		);
		expect(done).toMatchObject({ icon: null, kind: "expense" });
		expect(await rowOf(made.id)).toMatchObject({ icon: null, kind: "EXPENSE" });
	});

	it("is last write wins: a stale second write overwrites the first, with no refusal", async () => {
		const made = await fresh("Race");
		await expectBody(await patch(made.id, { color: "red" }), c.update);
		// Device B still believes the color is teal and sends the toggle only:
		// the color of the first write survives (partial), and the toggle lands.
		await expectBody(
			await patch(made.id, { excludeByDefault: true }),
			c.update,
		);
		expect(await rowOf(made.id)).toMatchObject({
			color: "red",
			excludeByDefault: true,
		});
		// The same field written twice: the later one wins, nothing is compared.
		await expectBody(await patch(made.id, { color: "lime" }), c.update);
		await expectBody(await patch(made.id, { color: "pink" }), c.update);
		expect((await rowOf(made.id)).color).toBe("pink");
	});

	it("a rename rewrites the name index of the new name", async () => {
		const made = await fresh("Old name");
		const before = (await rowOf(made.id)).nameIndex;
		await trpcOf(who).update({ id: made.id, name: "New name", color: "teal" });
		const after = (await rowOf(made.id)).nameIndex;
		if (!sealedSuite) return void expect([before, after]).toEqual([null, null]);
		expect(after).toMatch(INDEX);
		expect(after).not.toBe(before);
	});

	it("another user's category is not found, on tRPC and v1", async () => {
		const mine = await fresh("Mine");
		const other = await createTestUser();
		await expect(
			trpcOf(other).update({ id: mine.id, name: "Stolen", color: "teal" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expectProblem(
			await call(`/categories/${mine.id}`, {
				method: "PATCH",
				headers: await asMobile(other.user.id),
				body: { name: "Stolen" },
				idempotent: true,
			}),
			404,
			"not_found",
		);
		expect((await rowOf(mine.id)).name).toBe("Mine");
	});
});

describe("name taken", () => {
	let who: TestUser;
	let as: Record<string, string>;
	beforeAll(async () => {
		who = await createTestUser();
		as = await asMobile(who.user.id);
	});

	const create = (name: string) =>
		call("/categories", {
			method: "POST",
			headers: as,
			body: { name, color: "teal" },
			idempotent: true,
		});

	it("Food and food are two names, Food and 'Food ' are one, on both transports", async () => {
		const api = trpcOf(who);
		await api.create({ name: "Food", color: "teal" });
		await expectBody(await create("food"), c.create, 201);
		await expect(
			api.create({ name: "Food ", color: "teal" }),
		).rejects.toMatchObject(TAKEN);
		await expect(
			api.create({ name: "  Food", color: "teal" }),
		).rejects.toMatchObject(TAKEN);
		await expectProblem(await create(" Food  "), 409, "conflict");
		// Only the exact text is the same: an inner space or another letter is another name.
		await expectBody(await create("Fo od"), c.create, 201);
		await expectBody(await create("Foods"), c.create, 201);
		const names = (
			await fixtureDb.category.findMany({ where: { userId: who.user.id } })
		).map((row) => row.name);
		expect(names.sort()).toEqual(["Fo od", "Food", "Foods", "food"]);
	});

	it("the refusal is a TRPCError CONFLICT with one fixed message", async () => {
		const user = await createTestUser();
		await createCategory(user.db, user.user.id, {
			name: "Taken",
			color: "blue",
		});
		const refused = await createCategory(user.db, user.user.id, {
			name: "Taken",
			color: "blue",
		}).catch((e) => e as TRPCError);
		expect(refused).toBeInstanceOf(TRPCError);
		expect(refused).toMatchObject(TAKEN);
	});

	it("a rename to another category's name is refused, to its own name with other spacing is allowed", async () => {
		const user = await createTestUser();
		const asUser = await asMobile(user.user.id);
		const api = trpcOf(user);
		const a = await api.create({ name: "Alpha", color: "teal" });
		const b = await api.create({ name: "Beta ", color: "teal" });
		await expect(
			api.update({ id: b.id, name: "Alpha ", color: "teal" }),
		).rejects.toMatchObject(TAKEN);
		await expectProblem(
			await call(`/categories/${b.id}`, {
				method: "PATCH",
				headers: asUser,
				body: { name: "Alpha" },
				idempotent: true,
			}),
			409,
			"conflict",
		);
		const same = await api.update({ id: b.id, name: "Beta", color: "teal" });
		expect(same.name).toBe("Beta");
		expect((await rowOf(a.id)).name).toBe("Alpha");
	});

	it("two users may use one name", async () => {
		const [x, y] = [await createTestUser(), await createTestUser()];
		await trpcOf(x).create({ name: "Shared name", color: "teal" });
		await expect(
			trpcOf(y).create({ name: "Shared name", color: "teal" }),
		).resolves.toMatchObject({ name: "Shared name" });
	});
});

describe("the name check: index path and plaintext fallback", () => {
	const input = (name: string) => ({ name, color: "orange" as const });
	const STALE_TAG = `${"0".repeat(16)}:${"1".repeat(64)}`;

	// With a master key (the sealed suite) the rows carry an index, so these
	// set up the indexed states by hand. The plain suite has no master key:
	// every index is null, which is the fallback case itself.
	it("an index of another key (other tag) is not compared: the trimmed name decides", async () => {
		const user = await createTestUser();
		const food = await createCategory(user.db, user.user.id, input("Food"));
		await fixtureDb.category.update({
			where: { id: food.id },
			data: { nameIndex: STALE_TAG },
		});
		await expect(
			createCategory(user.db, user.user.id, input("Food ")),
		).rejects.toMatchObject(TAKEN);
		// A name that differs is free, and keeps the stale row's index as it was.
		await expect(
			createCategory(user.db, user.user.id, input("Foo")),
		).resolves.toMatchObject({ name: "Foo" });
		expect((await rowOf(food.id)).nameIndex).toBe(STALE_TAG);
	});

	it("a row with no index (not backfilled) is compared by its trimmed name, both ways", async () => {
		const user = await createTestUser();
		const legacy = await createCategory(user.db, user.user.id, input("Legacy"));
		await fixtureDb.category.update({
			where: { id: legacy.id },
			data: { nameIndex: null },
		});
		await expect(
			createCategory(user.db, user.user.id, input(" Legacy")),
		).rejects.toMatchObject(TAKEN);
		const other = await createCategory(user.db, user.user.id, input("Other"));
		await expect(
			updateCategory(user.db, user.user.id, other.id, { name: "Legacy " }),
		).rejects.toMatchObject(TAKEN);
		// "legacy" is another name, to the plaintext compare as to the index.
		await expect(
			createCategory(user.db, user.user.id, input("legacy")),
		).resolves.toMatchObject({ name: "legacy" });
	});

	it("with no master key the new index is null and an indexed row is compared by name", async () => {
		const user = await createTestUser();
		const none = { masterKeyring: null };
		const first = await createCategory(user.db, user.user.id, input("Keyless"));
		await expect(
			createCategory(user.db, user.user.id, input("Keyless "), none),
		).rejects.toMatchObject(TAKEN);
		const second = await createCategory(
			user.db,
			user.user.id,
			input("Keyless two"),
			none,
		).catch((e) => e as { code?: string });
		if (sealedSuite) {
			// A sealed name needs its index beside it: the write is refused, not made plain.
			expect(second).toMatchObject({ code: "category_index_missing" });
			expect(first.name).toBe("Keyless");
			return;
		}
		expect(second).toMatchObject({ name: "Keyless two" });
		expect((await rowOf((second as { id: string }).id)).nameIndex).toBeNull();
	});
});

describe("a device's UUID id", () => {
	it("is refused by the web's categories router before it reads anything (cuid only), while v1 takes it", async () => {
		const user = await createTestUser();
		const api = trpcOf(user);
		const uuid = randomUUID();
		const cuid = `c${uuid.replaceAll("-", "")}`;
		await expect(
			api.update({ id: uuid, name: "Food", color: "teal" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			api.remove({ id: uuid, targetId: null }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			api.remove({ id: cuid, targetId: uuid }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		// v1 reads the id as any string: the row is simply not found.
		await expectProblem(
			await call(`/categories/${uuid}`, {
				headers: await asMobile(user.user.id),
			}),
			404,
			"not_found",
		);
	});
});
