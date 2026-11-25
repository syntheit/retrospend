/**
 * The preview runner on a real Postgres, through the same userTransaction and
 * isolation levels forUser uses. The mutation and figure are test-only: they
 * count categories, a table with RLS, so a leak between users shows up as a
 * wrong count. XTS is the ISO 4217 code reserved for tests.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	createFiguresRegistry,
	type FigureDb,
	type FigureDefinition,
} from "~/server/figures/registry";
import { categoryNameIndexFor } from "~/server/services/category-name-index.service";
import { importRunner } from "~/server/services/import/runner";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { PreviewBusyError } from "./busy";
import { userTransactionRunner } from "./index";
import { createPreviewRunner } from "./runner";
import type { MoneyMutation } from "./types";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** No where clause on purpose: only RLS keeps another user's rows out. */
const visibleCategories: FigureDefinition = {
	id: "test.visibleCategories",
	scope: [],
	compute: async (tx) => ({
		minor: await tx.category.count(),
		currency: "XTS",
	}),
};

const figures = createFiguresRegistry<FigureDb>([visibleCategories]);

interface AddInput {
	/** A row of another user the mutation tries to read; RLS must hide it. */
	foreignId?: string;
	/** Runs on another connection mid-mutation, to test snapshot isolation. */
	concurrently?: () => Promise<unknown>;
}

interface AddValue {
	visibleBeforeWrite: number;
	sawForeignRow: boolean;
}

const addCategory: MoneyMutation<AddInput, AddValue> = {
	id: "test.addCategory",
	touches: ["test.visibleCategories"],
	run: async (tx, input, actor) => {
		const visibleBeforeWrite = await tx.category.count();
		const foreign = input.foreignId
			? await tx.category.findUnique({ where: { id: input.foreignId } })
			: null;
		const name = `Preview ${randomUUID()}`;
		const row = await tx.category.create({
			data: {
				name,
				nameIndex: await categoryNameIndexFor(tx, name),
				color: "blue",
				userId: actor.userId,
			},
		});
		await input.concurrently?.();
		return {
			value: { visibleBeforeWrite, sawForeignRow: foreign !== null },
			undo: {
				kind: "revert",
				mutation: "test.addCategory",
				rows: [{ table: "category", id: row.id }],
			},
		};
	},
};

const runnerFor = (user: TestUser) =>
	createPreviewRunner({
		figures,
		actor: { userId: user.user.id },
		transaction: userTransactionRunner(user.user.id),
	});

const countFor = (user: TestUser) =>
	fixtureDb.category.count({ where: { userId: user.user.id } });

const addCategoryTo = (user: TestUser) =>
	fixtureDb.category.create({
		data: {
			name: `Seed ${randomUUID()}`,
			color: "emerald",
			userId: user.user.id,
		},
	});

describe("preview on Postgres", () => {
	let alice: TestUser;
	let bob: TestUser;
	let bobCategoryId: string;

	beforeAll(async () => {
		alice = await createTestUser();
		bob = await createTestUser();
		await addCategoryTo(alice);
		await addCategoryTo(bob);
		await addCategoryTo(bob);
		bobCategoryId = (await addCategoryTo(bob)).id;
	});

	it("gets its own error back from Prisma, unchanged, and rolls back", async () => {
		const sentinel = new Error("sentinel");
		const before = await countFor(alice);

		const thrown = await userTransaction(adminDb, alice.user.id, async (tx) => {
			const name = `Doomed ${randomUUID()}`;
			await tx.category.create({
				data: {
					name,
					nameIndex: await categoryNameIndexFor(tx, name),
					color: "orange",
					userId: alice.user.id,
				},
			});
			throw sentinel;
		}).catch((error: unknown) => error);

		expect(thrown).toBe(sentinel);
		expect(await countFor(alice)).toBe(before);
	});

	it("returns the dry run's result and commits nothing", async () => {
		const before = await countFor(alice);

		const result = await runnerFor(alice).preview(addCategory, {});

		expect(result.changes).toEqual([
			expect.objectContaining({
				id: "test.visibleCategories",
				before: { minor: before, currency: "XTS" },
				after: { minor: before + 1, currency: "XTS" },
				delta: { minor: 1, currency: "XTS" },
			}),
		]);
		expect(await countFor(alice)).toBe(before);
	});

	it("keeps another user's rows out of the mutation and the figures", async () => {
		const own = await countFor(alice);

		const result = await runnerFor(alice).preview(addCategory, {
			foreignId: bobCategoryId,
		});

		expect(result.value).toEqual({
			visibleBeforeWrite: own,
			sawForeignRow: false,
		});
		expect(result.changes[0]?.before).toEqual({ minor: own, currency: "XTS" });
		expect(await countFor(bob)).toBe(3);
	});

	it("previews exactly what apply then does", async () => {
		const carol = await createTestUser();
		await addCategoryTo(carol);
		const runner = runnerFor(carol);

		const previewed = await runner.preview(addCategory, {});
		const { undo, ...applied } = await runner.apply(addCategory, {});

		expect(applied).toEqual(previewed);
		expect(undo).toMatchObject({
			kind: "revert",
			mutation: "test.addCategory",
		});
		expect(await countFor(carol)).toBe(2);
	});

	it("does not see a commit made by another connection between its snapshots", async () => {
		const dave = await createTestUser();
		const before = await countFor(dave);

		const previewed = await runnerFor(dave).preview(addCategory, {
			concurrently: () => addCategoryTo(dave),
		});
		// Read committed (apply) does see it, so the test can tell the two apart.
		const applied = await runnerFor(dave).apply(addCategory, {
			concurrently: () => addCategoryTo(dave),
		});

		expect(previewed.changes[0]?.delta).toEqual({ minor: 1, currency: "XTS" });
		expect(applied.changes[0]?.delta).toEqual({ minor: 2, currency: "XTS" });
		// The concurrent rows are real commits: one from each run, plus apply's own row.
		expect(await countFor(dave)).toBe(before + 3);
	});
});

/**
 * A preview runs at REPEATABLE READ, so an update of a row another connection
 * committed after the snapshot fails with 40001 (Prisma P2034). The mutation
 * makes that happen on purpose: `collide` commits a change to the same row from
 * another connection between the snapshot and the update.
 */
describe("preview that hits a serialization failure", () => {
	interface RenameInput {
		categoryId: string;
		/** Attempt numbers (1 is the first) that lose the race. */
		collideOn: number[];
		/** Throws a write conflict (P2034) or a plain error itself, in any isolation level. */
		fail?: "conflict" | "plain";
		/** Take the row with a raw FOR UPDATE (what the account and share locks do) instead of an update. */
		rawLock?: boolean;
	}

	/** One mutation object per test, so its attempt counter is the test's. */
	function renameMutation(touches = ["test.visibleCategories"]) {
		let attempts = 0;
		const mutation: MoneyMutation<RenameInput, { visibleBeforeWrite: number }> =
			{
				id: "test.renameCategory",
				touches,
				run: async (tx, input, actor) => {
					attempts += 1;
					const visibleBeforeWrite = await tx.category.count();
					if (input.fail === "plain") throw new Error("sentinel");
					if (input.fail === "conflict")
						throw Object.assign(new Error("write conflict"), {
							code: "P2034",
						});
					if (input.collideOn.includes(attempts))
						await fixtureDb.category.update({
							where: { id: input.categoryId },
							data: { color: attempts === 1 ? "orange" : "emerald" },
						});
					if (input.rawLock)
						await tx.$queryRaw`SELECT "id" FROM "category" WHERE "id" = ${input.categoryId} FOR UPDATE`;
					else
						await tx.category.update({
							where: { id: input.categoryId },
							data: { color: "violet" },
						});
					const name = `Preview ${randomUUID()}`;
					const row = await tx.category.create({
						data: {
							name,
							nameIndex: await categoryNameIndexFor(tx, name),
							color: "blue",
							userId: actor.userId,
						},
					});
					return {
						value: { visibleBeforeWrite },
						undo: {
							kind: "revert",
							mutation: "test.renameCategory",
							rows: [{ table: "category", id: row.id }],
						},
					};
				},
			};
		return { mutation, attempts: () => attempts };
	}

	const colorOf = async (id: string) =>
		(await fixtureDb.category.findUniqueOrThrow({ where: { id } })).color;

	it("runs again from a fresh transaction and answers what a clean preview answers", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		const clean = renameMutation();
		const expected = await runnerFor(user).preview(clean.mutation, {
			categoryId: seed.id,
			collideOn: [],
		});

		const raced = renameMutation();
		const result = await runnerFor(user).preview(raced.mutation, {
			categoryId: seed.id,
			collideOn: [1],
		});

		expect(raced.attempts()).toBe(2);
		expect(result).toEqual(expected);
		// The collision is the only write that stuck; the preview's rename and row rolled back.
		expect(await colorOf(seed.id)).toBe("orange");
		expect(await countFor(user)).toBe(1);
	});

	it("answers a stable PreviewBusyError after a second failure and writes nothing", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		const raced = renameMutation();

		const thrown = await runnerFor(user)
			.preview(raced.mutation, { categoryId: seed.id, collideOn: [1, 2] })
			.catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(PreviewBusyError);
		expect(raced.attempts()).toBe(2);
		expect(await countFor(user)).toBe(1);
	});

	it("retries a raw FOR UPDATE lock that lost the race, and ends busy on a second loss", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		const clean = renameMutation();
		const expected = await runnerFor(user).preview(clean.mutation, {
			categoryId: seed.id,
			collideOn: [],
			rawLock: true,
		});

		const once = renameMutation();
		const result = await runnerFor(user).preview(once.mutation, {
			categoryId: seed.id,
			collideOn: [1],
			rawLock: true,
		});
		expect(once.attempts()).toBe(2);
		expect(result).toEqual(expected);

		const twice = renameMutation();
		const thrown = await runnerFor(user)
			.preview(twice.mutation, {
				categoryId: seed.id,
				collideOn: [1, 2],
				rawLock: true,
			})
			.catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(PreviewBusyError);
		expect(twice.attempts()).toBe(2);
		expect(await countFor(user)).toBe(1);
	});

	it("retries an import preview the same way", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		// The import runner reads the real registry, which has no test figure.
		const raced = renameMutation([]);

		const result = await importRunner(user.user.id).preview(raced.mutation, {
			categoryId: seed.id,
			collideOn: [1],
		});

		expect(raced.attempts()).toBe(2);
		expect(result.value.visibleBeforeWrite).toBe(1);
	});

	it("never retries a write: apply throws the conflict as it always did", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		const write = renameMutation();

		const thrown = await runnerFor(user)
			.apply(write.mutation, {
				categoryId: seed.id,
				collideOn: [],
				fail: "conflict",
			})
			.catch((error: unknown) => error);

		expect(thrown).not.toBeInstanceOf(PreviewBusyError);
		expect((thrown as { code?: string }).code).toBe("P2034");
		expect(write.attempts()).toBe(1);
		expect(await countFor(user)).toBe(1);
	});

	it("does not retry any other preview error", async () => {
		const user = await createTestUser();
		const seed = await addCategoryTo(user);
		const write = renameMutation();

		const thrown = await runnerFor(user)
			.preview(write.mutation, {
				categoryId: seed.id,
				collideOn: [],
				fail: "plain",
			})
			.catch((error: unknown) => error);

		expect((thrown as Error).message).toBe("sentinel");
		expect(write.attempts()).toBe(1);
	});
});
