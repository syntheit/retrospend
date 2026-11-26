/**
 * v1's recurring confirm with `auto: true` (slice-device-income.md, PR B): the
 * phone's poster posts an auto-pay template through the same route a person
 * confirms with, and the server books it exactly as the sweep does. Income with
 * `auto` goes to confirmRecurringExpense (row only, no leg, the start of the
 * next day); income without it keeps the income mutation (its own tests).
 *
 * Base case, hand-derived: home ARS, blue 1,545 from Nov 30 (official 1,050 from
 * Dec 1 is not the preferred type); a monthly USD 1,000 income due 2026-12-01T00:00Z
 * (an income due day is a UTC day) books 1,000 x 1,545 = ARS 1,545,000.00 and the
 * template steps to 2027-01-01T00:00Z. A monthly USD 20 expense due 2026-12-01T03:00Z
 * books ARS 30,900.00. "Now" is 2026-12-01T12:00Z.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	expectBody,
	expectProblem,
} from "~/server/api/v1/core/__tests__/harness";
import { forUser } from "~/server/services/preview";
import { fixtureDb } from "~/test/pg-harness";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import { setupInput } from "../envelope/__tests__/pg-fixture";
import { sweepRecurringAutoPost } from "../recurring-auto-post";
import {
	arsUser,
	BA,
	booked,
	iso,
	STAMPED,
	setRates,
	sweepOnly,
	templateState,
	usdTemplate,
	v1For,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const NOW = new Date("2026-12-01T12:00:00.000Z");
const DUE_IN = "2026-12-01T00:00:00.000Z";
const NEXT_IN = "2027-01-01T00:00:00.000Z";
const DUE_OUT = "2026-12-01T03:00:00.000Z";
const STAMP = iso(STAMPED);

const at = (instant: Date) =>
	vi.useFakeTimers({ toFake: ["Date"], now: instant });
afterEach(() => vi.useRealTimers());

beforeAll(() =>
	setRates([
		["2026-11-30", "ARS", "blue", "1545"],
		["2026-12-01", "ARS", "official", "1050"],
	]),
);

const income = (userId: string, data: Parameters<typeof usdTemplate>[1] = {}) =>
	usdTemplate(userId, {
		name: "Salary",
		direction: "IN",
		amount: "1000",
		nextDueDate: new Date(DUE_IN),
		...data,
	});

type Answer = {
	confirmed: {
		expenseId: string;
		direction: string;
		nextDueAt: string | null;
		booked: unknown;
		account: unknown;
		kept: unknown;
		plan: unknown;
		templateUpdatedAt: string | null;
		expenseUpdatedAt?: string | null;
	};
	undo: string;
};

/** The stored row and nothing that names the user, the template or the clock. */
async function storedRow(userId: string) {
	const row = await fixtureDb.expense.findFirstOrThrow({ where: { userId } });
	const {
		id: _id,
		userId: _user,
		recurringTemplateId: _template,
		createdAt: _created,
		updatedAt: _updated,
		...rest
	} = row;
	return rest;
}

async function refusal(res: Response) {
	const body = (await res.json()) as { status: number; code: string };
	return [body.status, body.code] as const;
}

describe("income confirmed with auto books what the sweep books", () => {
	it("field by field the sweep's row: ARS 1,545,000.00, no leg, kept nowhere, the template one UTC month on", async () => {
		const [sweepUser, deviceUser] = [await arsUser(), await arsUser()];
		const [sweepTemplate, deviceTemplate] = [
			await income(sweepUser),
			await income(deviceUser),
		];
		for (const userId of [sweepUser, deviceUser])
			await fixtureDb.assetAccount.create({
				data: {
					userId,
					name: "Cash",
					type: "CASH",
					currency: "USD",
					balance: "100",
				},
			});
		at(NOW);
		await sweepRecurringAutoPost(NOW, sweepOnly(sweepUser));
		const clientId = randomUUID();
		const done = await expectBody<Answer>(
			await (await v1For(deviceUser))(
				"POST",
				`/recurring/${deviceTemplate}/confirm`,
				{
					dueAt: DUE_IN,
					expenseId: clientId,
					expectedUpdatedAt: STAMP,
					auto: true,
				},
			),
			contract.recurring.confirm,
		);
		vi.useRealTimers();

		expect(await storedRow(deviceUser)).toEqual(await storedRow(sweepUser));
		expect(await booked(deviceUser)).toMatchObject([
			{
				direction: "IN",
				inType: "INCOME",
				date: DUE_IN,
				amount: "1000",
				rateType: "blue",
				homeRate: "1545",
				home: "1545000",
				pricingSource: "RECURRING",
			},
		]);
		const stored = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: clientId },
		});
		expect(stored.keepInWealth).toBe(false);
		for (const userId of [sweepUser, deviceUser]) {
			expect(await fixtureDb.accountLeg.count({ where: { userId } })).toBe(0);
			const account = await fixtureDb.assetAccount.findFirstOrThrow({
				where: { userId },
			});
			expect(account.balance.toFixed()).toBe("100");
		}
		const [theirs, ours] = [
			await templateState(sweepTemplate),
			await templateState(deviceTemplate),
		];
		expect(ours).toMatchObject({
			nextDueDate: NEXT_IN,
			anchorDay: theirs.anchorDay,
			expenses: 1,
		});
		// The answer: an income entry, no account, no leg, no plan, both stamps as stored.
		expect(done.confirmed).toMatchObject({
			expenseId: clientId,
			direction: "in",
			nextDueAt: NEXT_IN,
			booked: null,
			account: null,
			kept: null,
			plan: null,
			templateUpdatedAt: ours.updatedAt,
			expenseUpdatedAt: iso(stored.updatedAt),
		});
		expect(ours.updatedAt).not.toBe(STAMP);
	});

	it("the preview twin is the dry run of the same write and books nothing", async () => {
		const me = await arsUser();
		const id = await income(me);
		at(NOW);
		const v1 = await v1For(me);
		const res = await v1("POST", `/recurring/${id}/confirm/preview`, {
			dueAt: DUE_IN,
			expenseId: randomUUID(),
			expectedUpdatedAt: STAMP,
			auto: true,
		});
		vi.useRealTimers();
		expect(res.status, await res.clone().text()).toBe(200);
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE_IN,
			updatedAt: STAMP,
		});
	});

	// An income row with no leg still raises Not planned yet: the preview must
	// say so. Budget in ARS from Dec 1 with ARS 1,000.00 to start, clock Dec 2
	// 12:00Z, the template due Dec 2 00:00Z (Dec 1 21:00 in Buenos Aires, the
	// budget's own month). Before: Not planned yet = the starting 1,000.00
	// (100,000 minor), nothing assigned. The row books USD 1,000 x 1,545 =
	// ARS 1,545,000.00 (154,500,000 minor), so it reads 1,546,000.00
	// (154,600,000). Left to spend is Σ Left of Spending (0) + min(0, ToAssign):
	// unchanged. No account changes.
	it("the preview names the budget figures the row moves, from the declared figures", async () => {
		const clock = new Date("2026-12-02T12:00:00.000Z");
		const me = await arsUser();
		const rent = await fixtureDb.category.create({
			data: { name: "Rent", color: "blue", userId: me },
		});
		const dining = await fixtureDb.category.create({
			data: { name: "Dining", color: "blue", userId: me },
		});
		at(clock);
		await forUser(me).apply(setupEnvelopeBook, {
			...setupInput({ rent: rent.id, dining: dining.id }),
			currency: "ARS",
			timeZone: BA,
		});
		const id = await income(me, {
			nextDueDate: new Date("2026-12-02T00:00:00.000Z"),
		});
		const res = await (await v1For(me))(
			"POST",
			`/recurring/${id}/confirm/preview`,
			{
				dueAt: "2026-12-02T00:00:00.000Z",
				expenseId: randomUUID(),
				expectedUpdatedAt: STAMP,
				auto: true,
			},
		);
		vi.useRealTimers();
		const body = await res.json();
		expect(res.status, JSON.stringify(body)).toBe(200);
		expect(body.changes).toEqual([
			expect.objectContaining({
				id: "budget.notPlannedYet",
				before: { minor: 100_000, currency: "ARS" },
				after: { minor: 154_600_000, currency: "ARS" },
				delta: { minor: 154_500_000, currency: "ARS" },
			}),
		]);
		expect(body.unavailable).toEqual([]);
		const unchanged = (body.unchanged as { id: string }[]).map((f) => f.id);
		expect(unchanged).toContain("budget.leftToSpend");
		expect((await templateState(id)).expenses).toBe(0);
	});

	it("a stale stamp is 409 recurring_changed on the confirm and its preview, and nothing is booked", async () => {
		const me = await arsUser();
		const id = await income(me);
		const v1 = await v1For(me);
		at(NOW);
		for (const path of ["confirm", "confirm/preview"])
			expect(
				await refusal(
					await v1("POST", `/recurring/${id}/${path}`, {
						dueAt: DUE_IN,
						expectedUpdatedAt: "2026-10-15T00:00:00.000Z",
						auto: true,
					}),
				),
			).toEqual([409, "recurring_changed"]);
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE_IN,
			updatedAt: STAMP,
			expenses: 0,
		});
	});

	for (const [why, data] of [
		["Ask each time", { amountMode: "ASK" as const }],
		["auto-pay turned off", { autoPay: false }],
	] as const)
		it(`${why} on the server: refused on the confirm and its preview, nothing is booked`, async () => {
			const me = await arsUser();
			const id = await income(me, data);
			const v1 = await v1For(me);
			at(NOW);
			for (const path of ["confirm", "confirm/preview"]) {
				const res = await v1("POST", `/recurring/${id}/${path}`, {
					dueAt: DUE_IN,
					expectedUpdatedAt: STAMP,
					auto: true,
				});
				expect(res.status, why).toBe(404);
				expect(await res.json()).toMatchObject({ code: "not_found" });
			}
			expect(await booked(me)).toEqual([]);
			expect((await templateState(id)).nextDueDate).toBe(DUE_IN);
		});

	it("takes none of the options a person's income confirm has", async () => {
		const me = await arsUser();
		const id = await income(me);
		const v1 = await v1For(me);
		at(NOW);
		for (const extra of [{ keep: true }, { usePlan: true }, { into: "a1" }]) {
			const res = await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE_IN,
				auto: true,
				...extra,
			});
			expect(res.status).toBe(400);
		}
		expect(await booked(me)).toEqual([]);
	});

	it("undo takes the row back and puts the template back on its due date and its anchor", async () => {
		const me = await arsUser();
		// A legacy template with no anchor: the confirm sets it, the undo clears it.
		const id = await income(me, { anchorDay: null });
		const v1 = await v1For(me);
		at(NOW);
		const done = await expectBody<Answer>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE_IN,
				auto: true,
			}),
			contract.recurring.confirm,
		);
		expect((await templateState(id)).anchorDay).not.toBeNull();
		const undone = await v1("POST", "/recurring/undo", { token: done.undo });
		expect(undone.status, await undone.clone().text()).toBe(200);
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE_IN,
			anchorDay: null,
			expenses: 0,
		});
	});

	it("undoing an older auto confirm after a second one is refused, and the newest can be undone", async () => {
		const me = await arsUser();
		const id = await income(me);
		const v1 = await v1For(me);
		// Both periods are overdue, so the poster catches up within seconds and
		// both undo tokens are fresh: only the ordering rule can refuse the older.
		at(new Date("2027-01-01T12:00:00.000Z"));
		const first = await expectBody<Answer>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE_IN,
				expectedUpdatedAt: STAMP,
				auto: true,
			}),
			contract.recurring.confirm,
		);
		const second = await expectBody<Answer>(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: NEXT_IN,
				expectedUpdatedAt: first.confirmed.templateUpdatedAt,
				auto: true,
			}),
			contract.recurring.confirm,
		);
		await expectProblem(
			await v1("POST", "/recurring/undo", { token: first.undo }),
			409,
			"conflict",
		);
		expect(await booked(me)).toHaveLength(2);
		const newest = await v1("POST", "/recurring/undo", { token: second.undo });
		expect(newest.status, await newest.clone().text()).toBe(200);
		expect(await booked(me)).toHaveLength(1);
		expect((await templateState(id)).nextDueDate).toBe(NEXT_IN);
	});

	it("without auto a person's income confirm keeps its own mutation: no client id, no stamp", async () => {
		const me = await arsUser();
		const id = await income(me);
		const v1 = await v1For(me);
		at(NOW);
		for (const extra of [
			{ expenseId: randomUUID() },
			{ expectedUpdatedAt: STAMP },
		]) {
			const res = await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE_IN,
				...extra,
			});
			expect(res.status).toBe(400);
		}
		expect(await booked(me)).toEqual([]);
		const done = await expectBody<Answer>(
			await v1("POST", `/recurring/${id}/confirm`, { dueAt: DUE_IN }),
			contract.recurring.confirm,
		);
		expect(done.confirmed).toMatchObject({
			direction: "in",
			templateUpdatedAt: null,
			expenseUpdatedAt: null,
		});
	});

	it("auto is true or absent: false is refused by the contract", async () => {
		const me = await arsUser();
		const id = await income(me);
		const res = await (await v1For(me))("POST", `/recurring/${id}/confirm`, {
			dueAt: DUE_IN,
			auto: false,
		});
		expect(res.status).toBe(400);
	});
});

describe("an expense confirmed with auto", () => {
	const expense = (userId: string, data = {}) => usdTemplate(userId, data);

	it("books what a confirm without it books when the template still pays automatically", async () => {
		const [a, b] = [await arsUser(), await arsUser()];
		const [withAuto, plain] = [await expense(a), await expense(b)];
		at(NOW);
		const done = await expectBody<Answer>(
			await (await v1For(a))("POST", `/recurring/${withAuto}/confirm`, {
				dueAt: DUE_OUT,
				expectedUpdatedAt: STAMP,
				auto: true,
			}),
			contract.recurring.confirm,
		);
		await expectBody(
			await (await v1For(b))("POST", `/recurring/${plain}/confirm`, {
				dueAt: DUE_OUT,
				expectedUpdatedAt: STAMP,
			}),
			contract.recurring.confirm,
		);
		expect(done.confirmed.direction).toBe("out");
		expect(await storedRow(a)).toEqual(await storedRow(b));
		expect(await booked(a)).toMatchObject([
			{ home: "30900", direction: "OUT" },
		]);
	});

	for (const [why, data] of [
		["auto-pay turned off", { autoPay: false }],
		["Ask each time", { amountMode: "ASK" as const }],
	] as const)
		it(`${why}: refused on the confirm and its preview, and the same confirm without auto books`, async () => {
			const me = await arsUser();
			const id = await expense(me, data);
			const v1 = await v1For(me);
			at(NOW);
			for (const path of ["confirm", "confirm/preview"]) {
				const res = await v1("POST", `/recurring/${id}/${path}`, {
					dueAt: DUE_OUT,
					expectedUpdatedAt: STAMP,
					auto: true,
				});
				expect(res.status, why).toBe(404);
			}
			expect(await booked(me)).toEqual([]);
			if (data.amountMode) return;
			await expectBody(
				await v1("POST", `/recurring/${id}/confirm`, {
					dueAt: DUE_OUT,
					expectedUpdatedAt: STAMP,
				}),
				contract.recurring.confirm,
			);
			expect(await booked(me)).toHaveLength(1);
		});
});
