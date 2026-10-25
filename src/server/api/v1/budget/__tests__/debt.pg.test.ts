/**
 * /api/v1/budget debts on Postgres: a debt's terms, the payoff plan and its
 * projection, and Pay down a debt with a preview and an undo. USD book with
 * 1,000.00 to start; Checking 5,000.00 and a Visa owing 1,200.00, both
 * opened through /api/v1/accounts. Paying 200.00 of principal and 22.00 of
 * interest leaves Visa at 1,000.00 and Checking at 4,778.00.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";
import { bookedUser, useBudgetV1, withoutStamps } from "./fixtures";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
const a = contract.accounts;
type Money = { minor: number; currency: string };
type Write = { result: Record<string, unknown>; undo: string | null };
type Preview = {
	changes: { id: string; delta: Money }[];
	detail?: { kind: string; result: unknown };
};

describe("/api/v1/budget debts", () => {
	useApiV1();
	useBudgetV1();
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let ids: Record<string, string>;
	let checking: string;
	let visa: string;

	const send = (method: string, path: string, body?: unknown, headers = as) =>
		call(path, { method, headers, body, idempotent: method !== "GET" });
	const balance = async (id: string) =>
		(
			await expectBody<{ balance: Money }>(
				await call(`/accounts/${id}`, { headers: as }),
				a.get,
			)
		).balance.minor;
	const open = async (name: string, type: string, amount: string) => {
		const id = randomUUID();
		await expectBody(
			await send("POST", "/accounts", {
				id,
				name,
				type,
				currency: "USD",
				balance: amount,
			}),
			a.create,
			201,
		);
		return id;
	};

	beforeAll(async () => {
		const s = await bookedUser();
		ids = s.ids;
		as = await asMobile(s.user.id);
		stranger = await asMobile((await bookedUser()).user.id);
		checking = await open("Checking", "CASH", "5000");
		visa = await open("Visa", "LIABILITY_CREDIT_CARD", "1200");
	});

	it("keeps a debt's terms and answers with the ones they replaced", async () => {
		const terms = await expectBody<{
			terms: { aprPercent: string | null };
			previous: { aprPercent: string | null };
		}>(
			await send("PUT", `/budget/debts/${visa}/terms`, {
				assetAccountId: visa,
				aprPercent: "24",
				minimumMinor: 5_000,
				dueDay: 15,
			}),
			c.setDebtTerms,
		);
		expect(terms.terms.aprPercent).toBe("24");
		expect(terms.previous.aprPercent).toBeNull();
	});

	it("saves a payoff plan, projects it and reverts the save", async () => {
		const saved = await expectBody<{ plan: { strategy: string } }>(
			await send("PUT", "/budget/payoff-plan", {
				strategy: "AVALANCHE",
				extraMonthlyMinor: 10_000,
				customOrder: [],
				envelopeId: null,
			}),
			c.savePayoffPlan,
		);
		expect(saved.plan.strategy).toBe("AVALANCHE");
		const plan = await expectBody<{ extraMonthly: Money }>(
			await call("/budget/payoff-plan", { headers: as }),
			c.payoffPlan,
		);
		expect(plan.extraMonthly).toEqual({ minor: 10_000, currency: "USD" });
		const projection = await expectBody<{
			debts: { assetAccountId: string }[];
			totalDebt: Money;
		}>(
			await call(
				"/budget/payoff-projection?strategy=SNOWBALL&extraMonthlyMinor=5000",
				{ headers: as },
			),
			c.payoffProjection,
		);
		expect(projection.debts.map((d) => d.assetAccountId)).toEqual([visa]);
		expect(projection.totalDebt).toEqual({ minor: 120_000, currency: "USD" });
		await expectBody(
			await send("POST", "/budget/payoff-plan/revert", {}),
			c.revertPayoffPlan,
		);
		const estimate = await expectBody<{ interest: Money | null }>(
			await call(`/budget/debts/${visa}/interest-estimate`, { headers: as }),
			c.interestEstimate,
		);
		expect(estimate).toHaveProperty("suggested");
	});

	it("pays down the card with a preview, and the token puts every number back", async () => {
		const body = {
			id: randomUUID(),
			liabilityId: visa,
			fromAccountId: checking,
			envelopeId: ids.Dining,
			principalMinor: 20_000,
			interestMinor: 2_200,
		};
		const preview = await expectBody<Preview>(
			await send("POST", "/budget/debt-payments/preview", body),
			c.previewRecordDebtPayment,
		);
		expect(await balance(visa)).toBe(120_000);
		const written = await expectBody<Write>(
			await send("POST", "/budget/debt-payments", body),
			c.recordDebtPayment,
			201,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await balance(visa)).toBe(100_000);
		expect(await balance(checking)).toBe(477_800);

		const undone = await expectBody<{ result: { kind: string } }>(
			await send("POST", "/budget/undo", { token: written.undo }),
			c.undo,
		);
		expect(undone.result.kind).toBe("debt_payment.delete");
		expect(await balance(visa)).toBe(120_000);
		expect(await balance(checking)).toBe(500_000);
		await expectProblem(
			await send("POST", "/budget/undo", { token: written.undo }),
			409,
			"conflict",
		);
	});

	it("keeps another person's accounts out of reach", async () => {
		await expectProblem(
			await send(
				"POST",
				"/budget/debt-payments",
				{
					id: randomUUID(),
					liabilityId: visa,
					fromAccountId: checking,
					envelopeId: null,
					principalMinor: 100,
					interestMinor: 0,
				},
				stranger,
			),
			404,
			"not_found",
		);
	});
});
