/**
 * A category is read by the people on a split expense filed under it (K7) and
 * written by its owner alone. Users: Ann owns Dining and shares E1 (filed under
 * it, created by Ann) with Ben; Cy is on a split with Ben that Ann is not on.
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import {
	sharedTx,
	shareOf,
} from "~/server/services/category/__tests__/merge-kit";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** Each test builds its own world: a red run of one test deletes Ann's category. */
async function world() {
	const ann = await seedUser();
	const ben = await createTestUser();
	const cy = await createTestUser();
	await forUser(ann.user.id).apply(setupEnvelopeBook, {
		...setupInput(ann),
		timeZone: "UTC",
	});
	const linkId = (
		await adminDb.envelopeCategory.findFirstOrThrow({
			where: { categoryId: ann.dining },
		})
	).id;
	const budgetId = (
		await adminDb.budget.create({
			data: {
				userId: ann.user.id,
				categoryId: ann.dining,
				period: new Date("2026-10-01T00:00:00Z"),
				amount: "50",
			},
		})
	).id;
	const prefId = (
		await adminDb.analyticsCategoryPreference.create({
			data: { userId: ann.user.id, categoryId: ann.dining, isFlexible: true },
		})
	).id;
	const e1 = await sharedTx(ann.user.id, ann.dining);
	// Ann created E1 and is not on it (I paid for you): the owner-created branch alone shows Dining to Ben.
	await shareOf(e1.id, ben.user.id, null);
	return { ann, ben, cy, linkId, budgetId, prefId };
}
type World = Awaited<ReturnType<typeof world>>;

const survivors = ({ ann, budgetId, linkId, prefId }: World) =>
	Promise.all([
		adminDb.category.count({ where: { id: ann.dining } }),
		adminDb.budget.count({ where: { id: budgetId } }),
		adminDb.envelopeCategory.count({ where: { id: linkId } }),
		adminDb.analyticsCategoryPreference.count({ where: { id: prefId } }),
	]);

describe("a category a co-participant can read", () => {
	it("is readable by the person on the split (K7)", async () => {
		const { ann, ben } = await world();
		await expect(
			ben.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.toMatchObject({ id: ann.dining, userId: ann.user.id });
	});

	it("is not deleted by that person, and the owner's budgets, links and preference survive", async () => {
		const w = await world();
		const { ann, ben } = w;
		const deleted = await ben.db.category.deleteMany({
			where: { id: ann.dining },
		});
		expect(deleted.count).toBe(0);
		expect(await survivors(w)).toEqual([1, 1, 1, 1]);
	});

	it("is not taken over by that person", async () => {
		const { ann, ben } = await world();
		const taken = await ben.db.category.updateMany({
			where: { id: ann.dining },
			data: { userId: ben.user.id },
		});
		expect(taken.count).toBe(0);
		await expect(
			adminDb.category.findUniqueOrThrow({ where: { id: ann.dining } }),
		).resolves.toMatchObject({ userId: ann.user.id });
	});

	it("is not changed by that person", async () => {
		const { ann, ben } = await world();
		const changed = await ben.db.category
			.updateMany({ where: { id: ann.dining }, data: { color: "red" } })
			.then(
				(r) => r.count,
				() => 0,
			);
		expect(changed).toBe(0);
		await expect(
			adminDb.category.findUniqueOrThrow({ where: { id: ann.dining } }),
		).resolves.toMatchObject({ color: "blue" });
	});

	it("is still deleted by its owner", async () => {
		const { ann } = await world();
		const spare = await fixtureDb.category.create({
			data: { name: "Spare", color: "blue", userId: ann.user.id },
		});
		const deleted = await ann.db.category.deleteMany({
			where: { id: spare.id },
		});
		expect(deleted.count).toBe(1);
	});
});

describe("a category filed on a split its owner is not on", () => {
	it("is not readable by the other people on that split", async () => {
		const { ann, ben, cy } = await world();
		// Ben filed Ann's category on a split with Cy, which Ann is not on: an old row.
		const e2 = await sharedTx(ben.user.id, ann.dining);
		await shareOf(e2.id, ben.user.id, null);
		await shareOf(e2.id, cy.user.id, null);

		await expect(
			cy.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.toBeNull();
		// Ben still reads it through E1, where the owner created the split.
		await expect(
			ben.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.not.toBeNull();
	});

	it("is readable when its owner is a person on that split", async () => {
		const { ann, ben, cy } = await world();
		// Ann is a person on a split that Ben created and filed under Ann's category.
		const e3 = await sharedTx(ben.user.id, ann.dining);
		await shareOf(e3.id, ann.user.id, null);
		await shareOf(e3.id, cy.user.id, null);

		await expect(
			cy.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.not.toBeNull();
	});
});

describe("a participant of another type with the owner's id is not the owner", () => {
	it("a split a guest created, with the owner's id, does not show the owner's category", async () => {
		const { ann, ben } = await world();
		const e = await sharedTx(ann.user.id, ann.dining, {
			createdByType: "guest",
			createdById: ann.user.id,
			paidById: ann.user.id,
		});
		await shareOf(e.id, ben.user.id, null);
		// Ben reads Dining through E1 (Ann created it), so look at the new split alone:
		await adminDb.sharedTransaction.deleteMany({
			where: { categoryId: ann.dining, id: { not: e.id } },
		});
		await expect(
			ben.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.toBeNull();
	});

	it("a shadow on the split with the owner's id is not the owner either", async () => {
		const { ann, ben, cy } = await world();
		await adminDb.sharedTransaction.deleteMany({
			where: { categoryId: ann.dining },
		});
		const e = await sharedTx(ben.user.id, ann.dining);
		await shareOf(e.id, cy.user.id, null);
		await shareOf(e.id, ann.user.id, null, { participantType: "shadow" });
		await expect(
			cy.db.category.findUnique({ where: { id: ann.dining } }),
		).resolves.toBeNull();
	});
});
