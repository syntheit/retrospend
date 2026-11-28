/**
 * The shown rule is stated twice in SQL: category_shown_on_split asks it of one
 * (category, split) pair (readers that bypass row level security, the public
 * totals), categories_shown_to as a set for the read policy (it reads the signed-in person from app.current_user_id). They may never
 * disagree. Every combination of who created the split and who is on it, with
 * a guest or shadow carrying the owner's id among them, gets its own category;
 * for the person on it, the pair answer must equal "the category is in their
 * set".
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

type Kind = "user" | "guest" | "shadow";

describe("category_shown_on_split and categories_shown_to", () => {
	it("agree on every combination of creator and people on the split", async () => {
		const owner = await createTestUser();
		const reader = await createTestUser();
		const other = await createTestUser();
		const creators = [
			{ type: "user" as Kind, id: owner.user.id, name: "creator is the owner" },
			{ type: "user" as Kind, id: other.user.id, name: "creator is another user" },
			{ type: "guest" as Kind, id: owner.user.id, name: "creator is a guest with the owner's id" },
		];
		const ownerOnSplit = [
			{ type: null, name: "owner not on it" },
			{ type: "user" as Kind, name: "owner on it" },
			{ type: "shadow" as Kind, name: "a shadow with the owner's id" },
			{ type: "guest" as Kind, name: "a guest with the owner's id" },
		];
		let shown = 0;
		let hidden = 0;
		for (const c of creators) {
			for (const o of ownerOnSplit) {
				const category = await fixtureDb.category.create({
					data: { name: `${c.name} / ${o.name}`, color: "blue", userId: owner.user.id },
				});
				const split = await adminDb.sharedTransaction.create({
					data: {
						description: "x",
						amount: "10",
						currency: "USD",
						date: new Date("2026-10-01"),
						categoryId: category.id,
						paidByType: c.type,
						paidById: c.id,
						createdByType: c.type,
						createdById: c.id,
						splitParticipants: {
							create: [
								{ participantType: "user", participantId: reader.user.id, shareAmount: "5" },
								...(o.type
									? [{ participantType: o.type, participantId: owner.user.id, shareAmount: "5" }]
									: []),
							],
						},
					},
				});
				const [pair] = await adminDb.$queryRaw<{ shown: boolean }[]>`
					SELECT category_shown_on_split(${category.id}, ${split.id}) AS shown`;
				const set = await adminDb.$transaction(async (tx) => {
					await tx.$executeRaw`SELECT set_config('app.current_user_id', ${reader.user.id}, true)`;
					return tx.$queryRaw<{ id: string }[]>`SELECT categories_shown_to() AS id`;
				});
				const inSet = set.some((r) => r.id === category.id);
				expect(inSet, `${c.name} / ${o.name}`).toBe(pair?.shown);
				if (inSet) shown++;
				else hidden++;
			}
		}
		// Both answers are reached: shown when the owner (as a user) created it (4) or is on it (2), else hidden.
		expect({ shown, hidden }).toEqual({ shown: 6, hidden: 6 });
	});

	it("shows nothing when no person is signed in", async () => {
		const none = await adminDb.$queryRaw<{ id: string }[]>`
			SELECT categories_shown_to() AS id`;
		expect(none).toEqual([]);
	});
});
