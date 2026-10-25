/**
 * An even split sent as percentages (100 / n) survives an amount edit on real
 * Postgres, through the real update path (no new split rows sent). Every
 * figure is worked out by hand in minor units.
 *
 * - ARS 100.00 over 3, payer first: 10000 = 3 x 3333 + 1 -> 33.34, 33.33,
 *   33.33. The database keeps 33.3333 each. Edit to 100.01 (3 x 3333 + 2):
 *   33.34, 33.34, 33.33. Edit to 200.00 (3 x 6666 + 2): 66.67, 66.67, 66.66.
 * - 7 ways, ARS 100.00: 10000 = 7 x 1428 + 4 -> four rows of 14.29, three of
 *   14.28. At 100.01 (7 x 1428 + 5): five of 14.29, two of 14.28. The Undo of
 *   that edit puts the 100.00 split back.
 * - Leftover units go to the payer first, then the others by key, so a create,
 *   an edit and an Undo of the same split give the same cents to the same
 *   people.
 * - ARS 1,234,567.91 over 3: 123456791 = 3 x 41152263 + 2 -> 411,522.64 twice,
 *   411,522.63. At 1,234,568.00 (3 x 41152266 + 2): 411,522.67 twice, .66.
 * - 0.004 ETH over 3, carol pays: 400000 = 3 x 133333 + 1 -> carol 0.00133334.
 *   At 0.00400001 (3 x 133333 + 2): the payer (carol), then the other by id.
 * - 12.3456 / 87.6544 typed, payer first: floor gives 1234 / 8765 of 10000
 *   cents and the leftover cent goes to the payer -> 12.35 / 87.65, kept to 4
 *   decimals. At 1000.00 floor gives 12345 / 87654 of 100000 and the leftover
 *   unit goes to the payer: 123.46 / 876.54.
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { arsUser, TODAY } from "../accounts/test-fixtures";
import {
	createSharedExpense,
	updateSharedExpense,
} from "../entry/shared.mutation";

async function group(size: number, payerIndex = 0) {
	const { user } = await arsUser();
	const others = await Promise.all(
		Array.from({ length: size - 1 }, () => createTestUser()),
	);
	const ids = [user.id, ...others.map((o) => o.user.id)];
	const refs = ids.map((participantId) => ({
		participantType: "user" as const,
		participantId,
	}));
	return { user, ids, refs, paidBy: refs[payerIndex]! };
}

type Group = Awaited<ReturnType<typeof group>>;

function create(
	g: Group,
	amount: number,
	currency: string,
	percentages: number[],
) {
	return forUser(g.user.id).apply(createSharedExpense, {
		amount,
		currency,
		description: "Dinner",
		date: TODAY,
		paidBy: g.paidBy,
		splitMode: "PERCENTAGE",
		splitWith: g.refs.map((r, i) => ({
			...r,
			sharePercentage: percentages[i]!,
		})),
	});
}

const editAmount = (g: Group, id: string, amount: number) =>
	forUser(g.user.id).apply(updateSharedExpense, { id, amount });

async function shares(g: Group, id: string) {
	const rows = await adminDb.splitParticipant.findMany({
		where: { transactionId: id },
	});
	const by = new Map(rows.map((r) => [r.participantId, r]));
	return {
		amounts: g.ids.map((i) => by.get(i)?.shareAmount.toString()),
		percentages: g.ids.map((i) => by.get(i)?.sharePercentage?.toString()),
	};
}

/**
 * The database keeps no typing order, so the leftover units go to the payer
 * first, then the others by key, on every path (create, edit, Undo). `count`
 * rows hold `high`, the rest `low`.
 */
async function expectLeftovers(
	g: Group,
	id: string,
	{ high, low, count }: { high: string; low: string; count: number },
) {
	const payer = g.paidBy.participantId;
	const order = [payer, ...g.ids.filter((i) => i !== payer).sort()];
	const have = (await shares(g, id)).amounts;
	const want = g.ids.map((i) => (order.indexOf(i) < count ? high : low));
	expect(have).toEqual(want);
}

describe("an even split after an amount edit", () => {
	it("3 ways: 100.00, then 100.01 and 200.00, exact each time", async () => {
		const g = await group(3);
		const made = await create(g, 100, "ARS", Array(3).fill(100 / 3));
		const id = made.value.id;
		expect(await shares(g, id)).toEqual({
			amounts: ["33.34", "33.33", "33.33"],
			percentages: ["33.3333", "33.3333", "33.3333"],
		});

		await editAmount(g, id, 100.01);
		await expectLeftovers(g, id, { high: "33.34", low: "33.33", count: 2 });

		await editAmount(g, id, 200);
		await expectLeftovers(g, id, { high: "66.67", low: "66.66", count: 2 });
	});

	it("7 ways: 100.00 and 100.01, and the Undo puts 100.00 back", async () => {
		const g = await group(7);
		const made = await create(g, 100, "ARS", Array(7).fill(100 / 7));
		const id = made.value.id;
		await expectLeftovers(g, id, { high: "14.29", low: "14.28", count: 4 });
		const at100 = (await shares(g, id)).amounts;

		const edited = await editAmount(g, id, 100.01);
		await expectLeftovers(g, id, { high: "14.29", low: "14.28", count: 5 });

		// The Undo sends back what the expense held before, rows in whatever
		// order the database gave them: the same cents to the same people.
		await forUser(g.user.id).apply(updateSharedExpense, edited.value.restore);
		expect((await shares(g, id)).amounts).toEqual(at100);
	});

	it("ARS 1,234,567.91 over 3, then 1,234,568.00", async () => {
		const g = await group(3);
		const made = await create(g, 1234567.91, "ARS", Array(3).fill(100 / 3));
		const id = made.value.id;
		await expectLeftovers(g, id, {
			high: "411522.64",
			low: "411522.63",
			count: 2,
		});
		await editAmount(g, id, 1234568);
		await expectLeftovers(g, id, {
			high: "411522.67",
			low: "411522.66",
			count: 2,
		});
	});

	it("0.004 ETH over 3 with the third person paying, then 0.00400001", async () => {
		const g = await group(3, 2);
		const made = await create(g, 0.004, "ETH", Array(3).fill(100 / 3));
		const id = made.value.id;
		expect((await shares(g, id)).amounts).toEqual([
			"0.00133333",
			"0.00133333",
			"0.00133334",
		]);
		await editAmount(g, id, 0.00400001);
		await expectLeftovers(g, id, {
			high: "0.00133334",
			low: "0.00133333",
			count: 2,
		});
	});
});

describe("typed percentages after an amount edit", () => {
	it("12.3456 / 87.6544 keep all 4 decimals and re-split from them", async () => {
		const g = await group(2);
		const made = await create(g, 100, "ARS", [12.3456, 87.6544]);
		const id = made.value.id;
		expect(await shares(g, id)).toEqual({
			amounts: ["12.35", "87.65"],
			percentages: ["12.3456", "87.6544"],
		});
		await editAmount(g, id, 1000);
		expect((await shares(g, id)).amounts).toEqual(["123.46", "876.54"]);
	});
});
