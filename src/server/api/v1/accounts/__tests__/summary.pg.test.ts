/**
 * GET /api/v1/accounts/summary on Postgres: the Wealth page's totals for the
 * phone. USD home, so every value is worked out by hand. Group totals, the
 * allocation bar, liquid money, the runway, what people owe each other and
 * Not tracked come from the server; another user's accounts never show;
 * no credentials is 401 and a token without the read scope is 403.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestUser, fixtureDb } from "~/test/pg-harness";
import {
	apiKeyFor,
	call,
	expectBody,
	expectProblem,
	asMobile as sessionHeaders,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Money = { minor: number; currency: string };
type Summary = {
	home: string;
	netWorth: Money;
	change: { days: number; total: Money; basis: number | null } | null;
	groups: { key: string; total: Money; series: number | null }[];
	allocation: { key: string; value: Money; share: number; series: number }[];
	liquid: Money;
	runway: { months: number; monthly: Money } | null;
	owed: { toYou: Money; youOwe: Money } | null;
	notTracked: Money | null;
	missingRates: number;
};

const usd = (minor: number) => ({ minor, currency: "USD" });
const IP = { "x-forwarded-for": "198.51.100.91" };

describe("GET /api/v1/accounts/summary", () => {
	let userId: string;
	let as: Record<string, string>;
	let strangerId: string;
	let stranger: Record<string, string>;

	const account = (
		owner: string,
		a: {
			name: string;
			type: "CASH" | "INVESTMENT" | "LIABILITY_CREDIT_CARD";
			balance: string;
			currency?: string;
			isLiquid?: boolean;
		},
	) =>
		fixtureDb.assetAccount.create({
			data: {
				userId: owner,
				name: a.name,
				type: a.type,
				currency: a.currency ?? "USD",
				balance: a.balance,
				exchangeRate: a.currency ? null : 1,
				isLiquid: a.isLiquid ?? false,
			},
		});

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = { ...(await sessionHeaders(userId)), ...IP };
		strangerId = (await createTestUser()).user.id;
		stranger = { ...(await sessionHeaders(strangerId)), ...IP };
		await account(userId, {
			name: "Checking",
			type: "CASH",
			balance: "1000",
			isLiquid: true,
		});
		await account(userId, {
			name: "Wallet",
			type: "CASH",
			balance: "540",
			isLiquid: true,
		});
		await account(userId, {
			name: "Broker",
			type: "INVESTMENT",
			balance: "3000",
		});
		await account(userId, {
			name: "Card",
			type: "LIABILITY_CREDIT_CARD",
			balance: "500",
		});
		// A currency with no rate anywhere: counted nowhere, never as 1.
		await account(userId, {
			name: "Mystery",
			type: "CASH",
			balance: "70",
			currency: "XTS",
		});
		// Cash withdrawn and put in no account: 40 of Wallet's 540 is Not tracked.
		const wallet = await fixtureDb.assetAccount.findFirstOrThrow({
			where: { userId, name: "Wallet" },
		});
		const moved = await call("/transfers", {
			method: "POST",
			headers: as,
			idempotent: true,
			body: {
				fromAccountId: wallet.id,
				toAccountId: null,
				toCurrency: "USD",
				fromAmount: "40",
				kind: "WITHDRAWAL",
			},
		});
		expect(moved.status, await moved.text()).toBe(201);
		await account(strangerId, {
			name: "Theirs",
			type: "CASH",
			balance: "99999",
			isLiquid: true,
		});
	});

	it("gives group totals, the allocation bar, liquid money and what is left out", async () => {
		const s = await expectBody<Summary>(
			await call("/accounts/summary", { headers: as }),
			contract.accounts.summary,
		);
		expect(s.home).toBe("USD");
		expect(s.netWorth).toEqual(usd(400_000));
		expect(s.groups).toEqual([
			{ key: "cash", total: usd(150_000), series: 2 },
			{ key: "investments", total: usd(300_000), series: 1 },
			{ key: "liabilities", total: usd(-50_000), series: null },
		]);
		// 1,500 and 3,000 of 4,500 counted, in basis points, largest first.
		expect(s.allocation).toEqual([
			{ key: "investments", value: usd(300_000), share: 6667, series: 1 },
			{ key: "cash", value: usd(150_000), share: 3333, series: 2 },
		]);
		expect(s.liquid).toEqual(usd(150_000));
		expect(s.missingRates).toBe(1);
		expect(s.runway).toBeNull();
		expect(s.owed).toEqual({ toYou: usd(0), youOwe: usd(0) });
		expect(s.notTracked).toEqual(usd(4_000));
	});

	it("shows nothing of another user's accounts", async () => {
		const s = await expectBody<Summary>(
			await call("/accounts/summary", { headers: stranger }),
			contract.accounts.summary,
		);
		expect(s.netWorth).toEqual(usd(9_999_900));
		expect(s.groups.map((g) => g.key)).toEqual(["cash"]);
		expect(s.liquid).toEqual(usd(9_999_900));
		expect(s.notTracked).toEqual(usd(0));
		expect(JSON.stringify(s)).not.toContain("150000");
	});

	it("needs credentials and the read scope", async () => {
		await expectProblem(
			await call("/accounts/summary", { headers: IP }),
			401,
			"unauthenticated",
		);
		const key = await apiKeyFor(userId, ["write:expenses"]);
		await expectProblem(
			await call("/accounts/summary", {
				headers: { ...IP, "x-api-key": key },
			}),
			403,
			"missing_scope",
		);
		const read = await apiKeyFor(userId, ["read"]);
		const ok = await call("/accounts/summary", {
			headers: { ...IP, "x-api-key": read },
		});
		expect(ok.status).toBe(200);
	});
});
