/**
 * /api/v1/budget writes that follow a month's money on Postgres: carry a real
 * overspend, apply a rule to this month's money in, fund a saved plan now.
 * Each has a preview that equals the write and an undo that puts every number
 * back exactly. USD books; expected values by hand.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	addRow,
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { addMonths } from "~/server/services/envelope/calendar";
import { budgetMonthOf, isoDateIn } from "~/server/services/envelope/months";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";
import { mobileFrom, movementShape, toV1, uuid } from "./fixtures";

const asMobile = mobileFrom("198.51.100.87");

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Preview = {
	changes: { id: string; delta: { minor: number } }[];
	detail?: { kind: string; result: unknown };
};
type Write = { result: Record<string, unknown>; undo: string | null };
type Month = {
	month: { key: number };
	toAssign: { amount: { minor: number } };
	groups: { envelopes: { id: string; left: { minor: number } }[] }[];
};

const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const firstDay = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 1));
const midMonth = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 12, 12));

async function bookedUser() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const ids = Object.fromEntries(
		book.envelopes.map((e) => [e.name, e.id]),
	) as Record<string, string>;
	return { ...s, book, ids };
}

describe("/api/v1/budget month-following writes", () => {

	const post = (path: string, body: unknown, headers: Record<string, string>) =>
		call(path, {
			method: "POST",
			headers,
			body: toV1(body),
			idempotent: true,
		});
	const monthOf = async (headers: Record<string, string>) =>
		expectBody<Month>(await call("/budget/month", { headers }), c.month);
	const leftOf = (m: Month, id: string) =>
		m.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left.minor;

	describe("carry an overspend", () => {
		let as: Record<string, string>;
		let b: Awaited<ReturnType<typeof bookedUser>>;

		beforeAll(async () => {
			b = await bookedUser();
			// The book started two months ago: Dining +300.00 and 100.00 spent then,
			// 50.00 of unplanned spending last month (Spending overspent by 50.00).
			const start = addMonths(current, -2);
			await adminDb.budgetBook.update({
				where: { id: b.book.id },
				data: { startMonth: start, startDate: firstDay(start) },
			});
			await adminDb.bookPeriod.updateMany({
				where: { bookId: b.book.id },
				data: { fromMonth: start },
			});
			if (b.book.startingBalanceExpenseId)
				await adminDb.expense.update({
					where: { id: b.book.startingBalanceExpenseId },
					data: { date: firstDay(start) },
				});
			await adminDb.budgetMovement.create({
				data: {
					id: randomUUID(),
					bookId: b.book.id,
					month: start,
					toEnvelopeId: b.ids.Dining,
					amount: 300,
					kind: "ASSIGN",
					actorUserId: b.user.id,
				},
			});
			await addRow(
				b.user.id,
				{ amount: 100, categoryId: b.dining },
				midMonth(start),
			);
			await addRow(b.user.id, { amount: 50 }, midMonth(addMonths(current, -1)));
			as = await asMobile(b.user.id);
		});

		it("takes last month's 50.00 overspend from this month, previews it, and undoes it exactly", async () => {
			const before = await monthOf(as);
			const body = {
				id: uuid(),
				envelopeId: b.ids.Spending,
				amountMinor: 5_000,
			};
			const preview = await expectBody<Preview>(
				await post("/budget/carry-overspend/preview", body, as),
				c.previewCarryOverspend,
			);
			expect(
				preview.changes.find((x) => x.id === "budget.notPlannedYet")?.delta,
			).toEqual({ minor: 5_000, currency: "USD" });
			expect((await monthOf(as)).toAssign).toEqual(before.toAssign);

			const written = await expectBody<Write>(
				await post("/budget/carry-overspend", body, as),
				c.carryOverspend,
			);
			expect(movementShape(written.result)).toEqual(
				movementShape(preview.detail?.result),
			);
			const after = await monthOf(as);
			expect(after.toAssign.amount.minor).toBe(
				before.toAssign.amount.minor + 5_000,
			);
			expect(leftOf(after, b.ids.Spending as string)).toBe(-5_000);

			// More than was overspent is refused: the cap is the engine's.
			await expectProblem(
				await post(
					"/budget/carry-overspend",
					{ ...body, id: uuid(), amountMinor: 1 },
					as,
				),
				400,
				"bad_request",
			);

			await expectBody(
				await post("/budget/undo", { token: written.undo }, as),
				c.undo,
			);
			expect((await monthOf(as)).toAssign).toEqual(before.toAssign);
			await expectProblem(
				await post("/budget/undo", { token: written.undo }, as),
				409,
				"conflict",
			);
		});
	});

	describe("apply a rule to this month's money in", () => {
		let as: Record<string, string>;
		let b: Awaited<ReturnType<typeof bookedUser>>;

		beforeAll(async () => {
			b = await bookedUser();
			as = await asMobile(b.user.id);
		});

		it("puts 10% of the 1,000.00 into Dining, once, and takes it back", async () => {
			await addRow(b.user.id, {
				amount: 1_000,
				direction: "IN",
				inType: "INCOME",
			});
			// A rule made after the money came in only runs on money to come.
			const rule = await expectBody<{ id: string }>(
				await post(
					"/budget/rules",
					{
						id: uuid(),
						name: "Dine",
						match: { kind: "ANY" },
						action: { kind: "PERCENT", basisPoints: 1_000 },
						envelopeId: b.ids.Dining,
					},
					as,
				),
				c.createRule,
				201,
			);
			const before = await monthOf(as);
			const body = { batchId: uuid(), ruleId: rule.id };
			const preview = await expectBody<Preview>(
				await post(`/budget/rules/${rule.id}/apply/preview`, body, as),
				c.previewApplyRule,
			);
			expect(preview.detail?.kind).toBe("envelope.applyRuleToMonth");
			expect(await monthOf(as)).toEqual(before);

			const written = await expectBody<Write>(
				await post(`/budget/rules/${rule.id}/apply`, body, as),
				c.applyRule,
			);
			const runs = (r: unknown) =>
				(r as { runs: { lines: unknown }[]; movement: unknown }).runs.map(
					(x) => x.lines,
				);
			expect(runs(written.result)).toEqual(runs(preview.detail?.result));
			expect(
				movementShape((written.result as { movement: unknown }).movement),
			).toEqual(
				movementShape(
					(preview.detail as { result: { movement: unknown } }).result.movement,
				),
			);
			const after = await monthOf(as);
			expect(leftOf(after, b.ids.Dining as string)).toBe(
				(leftOf(before, b.ids.Dining as string) ?? 0) + 10_000,
			);
			expect(after.toAssign.amount.minor).toBe(
				before.toAssign.amount.minor - 10_000,
			);

			await expectBody(
				await post("/budget/undo", { token: written.undo }, as),
				c.undo,
			);
			const undone = await monthOf(as);
			expect(leftOf(undone, b.ids.Dining as string)).toBe(
				leftOf(before, b.ids.Dining as string),
			);
			expect(undone.toAssign).toEqual(before.toAssign);
		});

		it("answers 404 for another person's rule", async () => {
			const other = await asMobile((await bookedUser()).user.id);
			await expectProblem(
				await post(
					`/budget/rules/${randomUUID()}/apply`,
					{ batchId: uuid(), ruleId: randomUUID() },
					other,
				),
				404,
				"not_found",
			);
		});
	});

	describe("use my plan on the pool", () => {
		let as: Record<string, string>;
		let b: Awaited<ReturnType<typeof bookedUser>>;

		beforeAll(async () => {
			b = await bookedUser();
			as = await asMobile(b.user.id);
		});

		it("plans 300.00 by the targets, previews first, and the token takes the batch back", async () => {
			const before = await monthOf(as);
			const body = { batchId: uuid(), amountMinor: 30_000, rest: "LEAVE" };
			const preview = await expectBody<Preview>(
				await post("/budget/use-plan/preview", body, as),
				c.previewUsePlan,
			);
			expect(await monthOf(as)).toEqual(before);
			const written = await expectBody<Write>(
				await post("/budget/use-plan", body, as),
				c.usePlan,
			);
			const lines = (r: unknown) => (r as { lines: unknown[] }).lines;
			expect(lines(written.result)).toEqual(lines(preview.detail?.result));
			expect(written.result.capped).toBeNull();
			const after = await monthOf(as);
			expect(after.toAssign.amount.minor).toBe(
				before.toAssign.amount.minor - 30_000,
			);
			await expectBody(
				await post("/budget/undo", { token: written.undo }, as),
				c.undo,
			);
			expect((await monthOf(as)).toAssign).toEqual(before.toAssign);
		});

		it("says where to cover an envelope from, with the amount and the suggested source", async () => {
			const cover = await expectBody<{
				need: { minor: number };
				sources: { from: string | null }[];
			}>(
				await call(`/budget/cover-sources?envelopeId=${b.ids.Rent}`, {
					headers: as,
				}),
				c.coverSources,
			);
			expect(cover.need).toEqual({ minor: 0, currency: "USD" });
			expect(cover.sources.length).toBeGreaterThan(0);
		});
	});

	describe("fund a saved plan now", () => {
		let as: Record<string, string>;
		let b: Awaited<ReturnType<typeof bookedUser>>;
		const draftId = uuid();

		beforeAll(async () => {
			b = await bookedUser();
			as = await asMobile(b.user.id);
			const next = addMonths(current, 1);
			await expectBody(
				await post(
					"/budget/drafts",
					{
						id: draftId,
						kind: "PLAN",
						month: next,
						lines: [
							{ envelopeId: b.ids.Rent, amountMinor: 50_000 },
							{ envelopeId: b.ids.Dining, amountMinor: 20_000 },
						],
					},
					as,
				),
				c.saveDraft,
			);
			await expectBody(
				await post(`/budget/drafts/${draftId}/apply`, { draftId }, as),
				c.applyDraft,
			);
		});

		it("writes the plan's 700.00 for next month, previews it first, and gives it back", async () => {
			const before = await monthOf(as);
			expect(before.toAssign.amount.minor).toBe(100_000);
			const body = { draftId, batchId: uuid() };
			const preview = await expectBody<Preview>(
				await post(`/budget/drafts/${draftId}/fund-now/preview`, body, as),
				c.previewFundPlanNow,
			);
			expect(await monthOf(as)).toEqual(before);

			const written = await expectBody<Write>(
				await post(`/budget/drafts/${draftId}/fund-now`, body, as),
				c.fundPlanNow,
			);
			// The write's rows carry ids and clocks the dry run made for itself.
			const shape = (r: unknown) =>
				movementShape((r as { movement: unknown }).movement);
			expect(shape(written.result)).toEqual(shape(preview.detail?.result));
			expect(shape(written.result)).toMatchObject({
				toAssign: {
					before: { minor: 100_000, currency: "USD" },
					after: { minor: 30_000, currency: "USD" },
				},
			});

			await expectBody(
				await post("/budget/undo", { token: written.undo }, as),
				c.undo,
			);
			expect((await monthOf(as)).toAssign.amount.minor).toBe(100_000);
			await expectProblem(
				await post("/budget/undo", { token: written.undo }, as),
				409,
				"conflict",
			);
		});
	});
});
