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
import { adminDb, createTestUser } from "~/test/pg-harness";
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
		const row = await tx.category.create({
			data: {
				name: `Preview ${randomUUID()}`,
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
	adminDb.category.count({ where: { userId: user.user.id } });

const addCategoryTo = (user: TestUser) =>
	adminDb.category.create({
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
			await tx.category.create({
				data: {
					name: `Doomed ${randomUUID()}`,
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
