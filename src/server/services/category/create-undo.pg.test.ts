/**
 * category.uncreate, the undo of a create, on a real Postgres. It deletes the
 * category only while nothing holds it: every holder the domain lists
 * (HOLDER_IDS, each foreign key to Category and each loose reference) is
 * counted under the category's lock before anything is deleted, rows the
 * caller cannot read included. ARS home. Each refusal moves nothing: the
 * category, the holder row and the stash table are as they were.
 *
 * A device-made category starts at version 0 under its own uuid.
 */
import { randomUUID } from "node:crypto";
import { HOLDER_IDS } from "@retrospend/domain/category-merge/holders";
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import {
	arsUser,
	expense,
	sharedTx,
	shareOf,
	templateOf,
} from "./__tests__/merge-kit";
import {
	createCategoryWrite,
	recreateCategory,
	uncreateCategory,
} from "./create.mutation";
import { HOLDERS } from "./holders";

const make = async (userId: string, name = "Cafe") =>
	(
		await forUser(userId).apply(createCategoryWrite, {
			id: randomUUID(),
			name,
			color: "teal",
		})
	).value.category;

const uncreate = (userId: string, id: string) =>
	forUser(userId).apply(uncreateCategory, { id });

const stillThere = (id: string) => fixtureDb.category.count({ where: { id } });

/** The refusal an undo gives when anything changed since: nothing moved. */
async function refused(userId: string, id: string) {
	await expect(uncreate(userId, id)).rejects.toMatchObject({
		code: "CONFLICT",
		message: "This changed since. Undo is no longer safe.",
	});
	await expect(stillThere(id)).resolves.toBe(1);
}

describe("category.uncreate", () => {
	let me: string;
	beforeAll(async () => {
		me = await arsUser();
	});

	it("has a count for every holder the domain lists", () => {
		expect(Object.keys(HOLDERS).sort()).toEqual([...HOLDER_IDS].sort());
		for (const id of HOLDER_IDS)
			expect(typeof HOLDERS[id].count, id).toBe("function");
	});

	it("deletes an empty category, keeps no row of it, and recreate brings it back under its id at its version", async () => {
		const made = await make(me, "Empty");
		expect(made.version).toBe(0);
		const gone = await uncreate(me, made.id);
		expect(gone.value.id).toBe(made.id);
		await expect(stillThere(made.id)).resolves.toBe(0);

		const back = await forUser(me).apply(recreateCategory, {
			stash: gone.value.stash,
		});
		expect(back.value.category).toMatchObject({
			id: made.id,
			name: "Empty",
			version: 0,
		});
		await expect(stillThere(made.id)).resolves.toBe(1);
	});

	it("is the preview of the same write: it counts and deletes nothing", async () => {
		const made = await make(me, "Preview only");
		const dry = await forUser(me).preview(uncreateCategory, { id: made.id });
		expect(dry.value.id).toBe(made.id);
		await expect(stillThere(made.id)).resolves.toBe(1);
	});

	it("refuses a category that is not the caller's, and one that is not there", async () => {
		const made = await make(me, "Mine");
		const other = await arsUser();
		await expect(uncreate(other, made.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(uncreate(me, randomUUID())).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(stillThere(made.id)).resolves.toBe(1);
	});

	describe("refuses, and moves nothing, while any holder names it", () => {
		it("an expense of the caller", async () => {
			const made = await make(me, "With expense");
			const e = await expense(me, made.id, 2);
			await refused(me, made.id);
			await expect(
				fixtureDb.expense.findUniqueOrThrow({ where: { id: e.id } }),
			).resolves.toMatchObject({ categoryId: made.id });
		});

		it("a recurring template", async () => {
			const made = await make(me, "With template");
			const t = await templateOf(me, made.id);
			await refused(me, made.id);
			await expect(
				fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id: t.id } }),
			).resolves.toMatchObject({ categoryId: made.id });
		});

		it("a budget", async () => {
			const made = await make(me, "With budget");
			await adminDb.budget.create({
				data: {
					userId: me,
					categoryId: made.id,
					period: new Date("2026-11-01T00:00:00Z"),
					amount: "50",
				},
			});
			await refused(me, made.id);
			await expect(
				adminDb.budget.count({ where: { categoryId: made.id } }),
			).resolves.toBe(1);
		});

		it("the analytics preference", async () => {
			const made = await make(me, "With preference");
			await adminDb.analyticsCategoryPreference.create({
				data: { userId: me, categoryId: made.id, isFlexible: true },
			});
			await refused(me, made.id);
			await expect(
				adminDb.analyticsCategoryPreference.count({
					where: { categoryId: made.id },
				}),
			).resolves.toBe(1);
		});

		it("an envelope link, an income rule and a draft in the caller's book", async () => {
			const s = await seedUser();
			await forUser(s.user.id).apply(setupEnvelopeBook, {
				...setupInput(s),
				timeZone: "UTC",
			});
			const book = await adminDb.budgetBook.findFirstOrThrow({
				where: { createdById: s.user.id },
				include: { envelopes: true },
			});
			const envelopeId = book.envelopes[0]?.id as string;

			const linked = await make(s.user.id, "Linked");
			await adminDb.envelopeCategory.create({
				data: { bookId: book.id, envelopeId, categoryId: linked.id },
			});
			await refused(s.user.id, linked.id);

			const ruled = await make(s.user.id, "Ruled");
			await adminDb.incomeRule.create({
				data: {
					id: randomUUID(),
					bookId: book.id,
					sortOrder: 0,
					name: "Gigs",
					matchKind: "CATEGORY",
					matchValue: ruled.id,
					action: "REMAINDER",
					envelopeId,
				},
			});
			await refused(s.user.id, ruled.id);

			const drafted = await make(s.user.id, "Drafted");
			await adminDb.budgetDraft.create({
				data: {
					id: randomUUID(),
					bookId: book.id,
					month: 202612,
					kind: "WHAT_IF",
					createdById: s.user.id,
					expectedIn: [],
					pretend: [
						{
							id: "p1",
							kind: "OUT",
							categoryId: drafted.id,
							amountMinor: 50,
						},
					],
				},
			});
			await refused(s.user.id, drafted.id);
		});

		it("a share of the caller's, and a shared expense the caller made", async () => {
			const made = await make(me, "Shared mine");
			const tx = await sharedTx(me, made.id);
			await refused(me, made.id);
			await adminDb.sharedTransaction.update({
				where: { id: tx.id },
				data: { categoryId: null },
			});
			const share = await shareOf(tx.id, me, made.id);
			await refused(me, made.id);
			await expect(
				fixtureDb.splitParticipant.findUniqueOrThrow({
					where: { id: share.id },
				}),
			).resolves.toMatchObject({ categoryId: made.id });
		});

		it("a shared expense of someone else that the caller cannot read", async () => {
			const made = await make(me, "Hidden row");
			const stranger = await arsUser();
			const tx = await sharedTx(stranger, made.id);
			// Nothing ties the caller to the row: their client does not see it.
			await expect(
				forUser(me).apply(
					{
						id: "test.readHidden",
						touches: [],
						run: async (t) => ({
							value: await t.sharedTransaction.count({ where: { id: tx.id } }),
							undo: { kind: "revert", mutation: "x", rows: [] },
						}),
					},
					{},
				),
			).resolves.toMatchObject({ value: 0 });
			await refused(me, made.id);
			await expect(
				adminDb.sharedTransaction.findUniqueOrThrow({ where: { id: tx.id } }),
			).resolves.toMatchObject({ categoryId: made.id });
		});

		it("a shared expense in a project the creator has left", async () => {
			const made = await make(me, "Left a project");
			const host = await arsUser();
			const project = await adminDb.project.create({
				data: { name: "Trip", createdById: host },
			});
			await adminDb.projectParticipant.createMany({
				data: [
					{
						projectId: project.id,
						participantType: "user",
						participantId: host,
						role: "ORGANIZER",
					},
					{
						projectId: project.id,
						participantType: "user",
						participantId: me,
						role: "EDITOR",
					},
				],
			});
			// The creator, an editor, filed the host's expense under their own category, then left.
			const tx = await sharedTx(host, made.id, { projectId: project.id });
			const share = await shareOf(tx.id, me, null);
			await adminDb.splitParticipant.delete({ where: { id: share.id } });
			await adminDb.projectParticipant.deleteMany({
				where: { projectId: project.id, participantId: me },
			});
			await refused(me, made.id);
			await expect(
				adminDb.sharedTransaction.findUniqueOrThrow({ where: { id: tx.id } }),
			).resolves.toMatchObject({ categoryId: made.id });
		});
	});
});
