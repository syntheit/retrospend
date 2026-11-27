/**
 * An envelope names only the person's own categories. Ann owns Dining and
 * Salary (income) and shares a split filed under both with Ben, so Ben can
 * read them (K7): the old checks relied on row level security alone and let
 * Ben's envelope, setup, rule and draft take them. Each is refused with
 * INVALID, and what Ben owns is still taken.
 */
import { randomUUID } from "node:crypto";
import { budgetMonthOf, isoDateIn } from "@retrospend/domain/envelope/months";
import { describe, expect, it } from "vitest";
import { sharedTx, shareOf } from "~/server/services/category/__tests__/merge-kit";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { augustBook, seedUser, setupInput } from "./__tests__/pg-fixture";
import { createEnvelopeMutation, updateEnvelopeMutation } from "./crud.mutation";
import { saveDraft } from "./draft.service";
import { createRule } from "./rule-crud.service";
import { setupEnvelopeBook } from "./setup.mutation";

const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);

/** Ben has a budget; Ann's Dining and Salary are on splits they share, so his client reads them. */
async function world() {
	const ben = await augustBook();
	const ann = await seedUser();
	const salary = (
		await fixtureDb.category.create({
			data: { name: "Salary", color: "emerald", kind: "INCOME", userId: ann.user.id },
		})
	).id;
	for (const category of [ann.dining, salary]) {
		const split = await sharedTx(ann.user.id, category);
		await shareOf(split.id, ann.user.id, null);
		await shareOf(split.id, ben.user.id, null);
	}
	await expect(
		ben.db.category.findUnique({ where: { id: ann.dining } }),
	).resolves.not.toBeNull();
	return { ben, ann, salary };
}

describe("a category another person's split shows me is not mine to use", () => {
	it("refuses it on a new envelope and on an edit, and takes my own", async () => {
		const { ben, ann } = await world();
		const mine = (
			await fixtureDb.category.create({
				data: { name: "Coffee", color: "blue", userId: ben.user.id },
			})
		).id;
		const create = (categoryIds: string[]) => ({
			id: randomUUID(),
			name: "Mixed",
			groupId: null,
			kind: "NONE" as const,
			categoryIds,
		});
		await expect(
			forUser(ben.user.id).apply(createEnvelopeMutation, create([ann.dining])),
		).rejects.toMatchObject({ code: "INVALID" });
		const made = create([mine]);
		await forUser(ben.user.id).apply(createEnvelopeMutation, made);
		await expect(
			forUser(ben.user.id).apply(updateEnvelopeMutation, {
				id: randomUUID(),
				envelopeId: made.id,
				categoryIds: [mine, ann.dining],
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			adminDb.envelopeCategory.count({ where: { categoryId: ann.dining } }),
		).resolves.toBe(0);
	});

	it("refuses it in a setup", async () => {
		const { ann } = await world();
		const fresh = await seedUser();
		const input = { ...setupInput(fresh), timeZone: "UTC" };
		input.envelopes[1] = {
			...input.envelopes[1],
			categoryIds: [ann.dining],
		} as never;
		// The new user reads Ann's category only through a split they are on.
		const split = await sharedTx(ann.user.id, ann.dining);
		await shareOf(split.id, ann.user.id, null);
		await shareOf(split.id, fresh.user.id, null);
		await expect(
			forUser(fresh.user.id).apply(setupEnvelopeBook, input as never),
		).rejects.toMatchObject({ code: "INVALID" });
	});

	it("refuses it as an income rule's category", async () => {
		const { ben, salary } = await world();
		const rule = (categoryId: string) =>
			userTransaction(adminDb, ben.user.id, (tx) =>
				createRule(
					tx,
					ben.user.id,
					{
						id: randomUUID(),
						name: "Save",
						match: { kind: "CATEGORY", categoryId },
						action: { kind: "PERCENT", basisPoints: 1000 },
						envelopeId: ben.diningEnv,
					} as never,
					new Date(),
				),
			);
		await expect(rule(salary)).rejects.toMatchObject({ code: "INVALID" });
		const mine = (
			await fixtureDb.category.create({
				data: { name: "Pay", color: "emerald", kind: "INCOME", userId: ben.user.id },
			})
		).id;
		await expect(rule(mine)).resolves.toBeDefined();
	});

	it("refuses it in a draft", async () => {
		const { ben, ann } = await world();
		await expect(
			userTransaction(adminDb, ben.user.id, (tx) =>
				saveDraft(
					tx,
					ben.user.id,
					{
						id: randomUUID(),
						kind: "WHAT_IF",
						month: current,
						lines: [],
						moves: [],
						expectedIn: [],
						pretend: [
							{
								id: randomUUID(),
								kind: "OUT",
								categoryId: ann.dining,
								envelopeId: null,
								amountMinor: 1000,
							},
						],
					},
					new Date(),
				),
			),
		).rejects.toMatchObject({ code: "INVALID" });
	});
});
