/**
 * GET /api/v1/sync/shares on Postgres (E2EE P16), through the handler the Next
 * route uses: every participation of the caller by access alone (a rejected
 * share and one in a hidden project too), the category rule of budget D19,
 * no text of the expense, Owed to you and You owe from the same read, and the
 * scope. Owed values are derived by hand: home USD, NZD at 1.5 per USD.
 */
import { randomUUID } from "node:crypto";
import { contract, SCOPES } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { owedOnce } from "~/server/services/payments/figures";
import { readShareSnapshot } from "~/server/services/sync/snapshots";
import { Prisma } from "~prisma";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	fixtureDb,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// Lets one test act between the shares read and the owed read: it commits a
// write on another connection, or tries one on the snapshot's own transaction.
const between = vi.hoisted(() => ({
	run: null as null | ((tx: unknown) => Promise<void>),
}));
vi.mock("~/server/services/payments/figures", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/server/services/payments/figures")>();
	return {
		...actual,
		owedOnce: async (...args: Parameters<typeof actual.owedOnce>) => {
			await between.run?.(args[0]);
			return actual.owedOnce(...args);
		},
	};
});

type Body = {
	items: Record<string, unknown>[];
	owed:
		| { owedToYou: { minor: number; currency: string }; youOwe: object }
		| { missingRates: string[] };
};

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.93" };

const pull = async (headers: Record<string, string>) =>
	expectBody<Body>(
		await call("/sync/shares", { headers: { ...OWN_IP, ...headers } }),
		contract.sync.shares,
	);

const D = (v: string) => new Prisma.Decimal(v);
const DAY = new Date("2026-10-05T12:00:00Z");

/** A shared expense Bob paid and created, with these participations. */
async function sharedExpense(
	bob: string,
	parts: { userId: string; amount: string; status?: "ACCEPTED" | "REJECTED" }[],
	extra: {
		amount?: string;
		currency?: string;
		rate?: string;
		projectId?: string;
		categoryId?: string;
		correctsId?: string;
		paidBy?: string;
		createdBy?: string;
	} = {},
) {
	const id = randomUUID();
	await fixtureDb.sharedTransaction.create({
		data: {
			id,
			description: "private dinner",
			notes: "secret note",
			amount: D(extra.amount ?? "100"),
			currency: extra.currency ?? "USD",
			date: DAY,
			exchangeRate: extra.rate ? D(extra.rate) : null,
			projectId: extra.projectId ?? null,
			categoryId: extra.categoryId ?? null,
			correctsId: extra.correctsId ?? null,
			paidByType: "user",
			paidById: extra.paidBy ?? bob,
			createdByType: "user",
			createdById: extra.createdBy ?? bob,
			splitParticipants: {
				create: parts.map((p) => ({
					id: randomUUID(),
					participantType: "user",
					participantId: p.userId,
					shareAmount: D(p.amount),
					verificationStatus: p.status ?? "ACCEPTED",
				})),
			},
		},
	});
	return id;
}

describe("shares sync route: who may call it", () => {
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("answers a mobile app session", async () => {
		const res = await call("/sync/shares", {
			headers: { ...OWN_IP, ...(await asMobile(userId)) },
		});
		expect(res.status, await res.text()).toBe(200);
	});

	it("needs credentials and refuses a key with every token scope", async () => {
		await expectProblem(
			await call("/sync/shares", { headers: OWN_IP }),
			401,
			"unauthenticated",
		);
		const res = await call("/sync/shares", {
			headers: { ...OWN_IP, ...(await asKey(userId, [...SCOPES])) },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "missing_scope",
			requiredScope: "sync",
		});
	});

	it("refuses the web app's cookie session", async () => {
		await expectProblem(
			await call("/sync/shares", {
				headers: { ...OWN_IP, ...(await webCookieFor(userId)) },
			}),
			403,
			"missing_scope",
		);
	});
});

describe("shares sync route: the rows", () => {
	let alice: string;
	let bob: string;
	let carol: string;
	let asAlice: Record<string, string>;
	const ids: Record<string, string> = {};
	const participation: Record<string, string> = {};

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		carol = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		const bobCategory = await fixtureDb.category.create({
			data: { name: "Bob's", color: "blue", userId: bob },
		});
		const aliceCategory = await fixtureDb.category.create({
			data: { name: "Mine", color: "emerald", userId: alice },
		});
		const hidden = await adminDb.project.create({
			data: { name: "Hidden", createdById: bob, primaryCurrency: "USD" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: hidden.id,
				participantType: "user",
				participantId: alice,
				excludeFromAnalytics: true,
			},
		});
		ids.plain = await sharedExpense(
			bob,
			[
				{ userId: alice, amount: "30" },
				{ userId: carol, amount: "70" },
			],
			{ currency: "ARS", rate: "1500.5", categoryId: bobCategory.id },
		);
		ids.rejected = await sharedExpense(
			bob,
			[{ userId: alice, amount: "5", status: "REJECTED" }],
			{ currency: "USD" },
		);
		ids.hidden = await sharedExpense(bob, [{ userId: alice, amount: "7" }], {
			projectId: hidden.id,
		});
		ids.own = await sharedExpense(alice, [{ userId: alice, amount: "9" }], {
			categoryId: aliceCategory.id,
			currency: "JPY",
		});
		ids.correction = await sharedExpense(
			bob,
			[{ userId: alice, amount: "-4.5" }],
			{ correctsId: ids.plain },
		);
		ids.carolOnly = await sharedExpense(bob, [{ userId: carol, amount: "11" }]);
		for (const p of await adminDb.splitParticipant.findMany({
			where: { participantId: alice },
		}))
			participation[p.transactionId] = p.id;
	});

	it("returns every participation of the caller, whatever its status or project", async () => {
		const body = await pull(asAlice);
		expect(body.items.map((r) => r.expenseId).sort()).toEqual(
			[
				ids.plain,
				ids.rejected,
				ids.hidden,
				ids.own,
				ids.correction,
			].sort() as string[],
		);
		const by = (expense: string) =>
			body.items.find((r) => r.expenseId === expense);
		expect(by(ids.rejected as string)).toMatchObject({
			id: participation[ids.rejected as string],
			shareAmount: "5",
			verificationStatus: "REJECTED",
			currency: "USD",
			exchangeRate: null,
		});
		expect(by(ids.hidden as string)?.projectId).not.toBeNull();
		// Another participant's row of the same expense is not Alice's.
		expect(body.items.filter((r) => r.expenseId === ids.plain)).toHaveLength(1);
		expect(by(ids.plain as string)).toMatchObject({
			shareAmount: "30",
			currency: "ARS",
			exchangeRate: "1500.5",
			date: DAY.toISOString(),
		});
		expect(by(ids.correction as string)?.shareAmount).toBe("-4.5");
	});

	it("gives a category only when it is the caller's own (D19)", async () => {
		const body = await pull(asAlice);
		const by = (expense: string) =>
			body.items.find((r) => r.expenseId === expense);
		// Bob's category on Bob's expense is not Alice's to use.
		expect(by(ids.plain as string)?.expenseCategoryId).toBeNull();
		const mine = await adminDb.category.findFirstOrThrow({
			where: { userId: alice },
		});
		expect(by(ids.own as string)?.expenseCategoryId).toBe(mine.id);
	});

	it("sends no description, notes, payer, other participant or project name", async () => {
		const res = await call("/sync/shares", {
			headers: { ...OWN_IP, ...asAlice },
		});
		const text = await res.text();
		const raw = JSON.parse(text) as Body;
		for (const row of raw.items)
			expect(Object.keys(row).sort()).toEqual(
				[
					"currency",
					"date",
					"expenseCategoryId",
					"expenseId",
					"exchangeRate",
					"id",
					"projectId",
					"shareAmount",
					"verificationStatus",
				].sort(),
			);
		for (const leaked of [
			"private dinner",
			"secret note",
			bob,
			carol,
			"Hidden",
		])
			expect(text).not.toContain(leaked);
	});

	it("is empty for a person who shares nothing", async () => {
		const stranger = (await createTestUser()).user.id;
		const body = await pull(await asMobile(stranger));
		expect(body.items).toEqual([]);
		expect(body.owed).toEqual({
			owedToYou: { minor: 0, currency: "USD" },
			youOwe: { minor: 0, currency: "USD" },
		});
	});
});

describe("shares sync route: owed", () => {
	const setup = async (home: string) => {
		const me = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: me },
			data: { homeCurrency: home },
		});
		return { me, bob, as: await asMobile(me) };
	};

	// The rate table is shared by the files of a worker: add the NZD row only if
	// it is not there, and delete only a row this file added, by id.
	let nzdRates: string[] = [];

	beforeAll(async () => {
		const added = await adminDb.exchangeRate.createManyAndReturn({
			skipDuplicates: true,
			select: { id: true },
			data: [
				{
					date: new Date("2026-01-01T00:00:00Z"),
					currency: "NZD",
					type: "official",
					rate: "1.5",
				},
			],
		});
		nzdRates = added.map((r) => r.id);
	});

	afterAll(async () => {
		await adminDb.exchangeRate.deleteMany({ where: { id: { in: nzdRates } } });
	});

	// Bob paid USD 40 and NZD 30 for Alice's shares: Alice owes Bob USD 40.00
	// and NZD 30.00 (USD 20 at 1.5 NZD per USD). In USD she owes 40 + 20 = 60.00,
	// 6,000 minor; she is owed nothing.
	it("reads You owe in the home currency, as the figure does", async () => {
		const { me, bob, as } = await setup("USD");
		await sharedExpense(bob, [{ userId: me, amount: "40" }], {
			currency: "USD",
			amount: "40",
		});
		await sharedExpense(bob, [{ userId: me, amount: "30" }], {
			currency: "NZD",
			amount: "30",
		});
		const body = await pull(as);
		expect(body.owed).toEqual({
			owedToYou: { minor: 0, currency: "USD" },
			youOwe: { minor: 6000, currency: "USD" },
		});
		// The same reading the figure gives, not a second computation.
		const figure = await userTransaction(adminDb, me, (tx) => owedOnce(tx, me));
		expect(figure).toMatchObject({
			owedToYou: 0,
			youOwe: 6000,
			currency: "USD",
		});
	});

	it("names the currencies that have no rate, and no totals", async () => {
		const { me, bob, as } = await setup("USD");
		await sharedExpense(bob, [{ userId: me, amount: "12.34" }], {
			currency: "XQZ",
			amount: "12.34",
		});
		const body = await pull(as);
		expect(body.owed).toEqual({ missingRates: ["XQZ"] });
	});

	it("shows what Alice is owed apart from what she owes", async () => {
		const { me, bob, as } = await setup("USD");
		// Alice paid USD 50 for Bob's share (he owes her 50.00); Bob paid USD 8 for hers.
		await sharedExpense(
			me,
			[
				{ userId: bob, amount: "50" },
				{ userId: me, amount: "0" },
			],
			{ currency: "USD", amount: "50", paidBy: me, createdBy: me },
		);
		await sharedExpense(bob, [{ userId: me, amount: "8" }], {
			currency: "USD",
			amount: "8",
		});
		const body = await pull(as);
		// Bob owes her 50 and she owes him 8: his net with her is 42.00 in her favor.
		expect(body.owed).toEqual({
			owedToYou: { minor: 4200, currency: "USD" },
			youOwe: { minor: 0, currency: "USD" },
		});
	});
});

describe("shares sync route: one snapshot", () => {
	// Alice owes Bob USD 10. While the read is between its two queries, Bob
	// records another USD 25 she owes. At repeatable read both queries see the
	// state from before: one share and 1,000 owed. At read committed the shares
	// would be one and the owed 3,500.
	it("reads the shares and the owed totals from one database snapshot", async () => {
		const alice = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: alice },
			data: { homeCurrency: "USD" },
		});
		await sharedExpense(bob, [{ userId: alice, amount: "10" }], {
			currency: "USD",
			amount: "10",
		});
		between.run = async () => {
			between.run = null;
			await sharedExpense(bob, [{ userId: alice, amount: "25" }], {
				currency: "USD",
				amount: "25",
			});
		};
		try {
			const snapshot = await readShareSnapshot(adminDb, alice);
			expect(snapshot.shares).toHaveLength(1);
			expect(snapshot.owed).toMatchObject({ youOwe: 1000, owedToYou: 0 });
		} finally {
			between.run = null;
		}
		// The next read sees the commit.
		const next = await readShareSnapshot(adminDb, alice);
		expect(next.shares).toHaveLength(2);
		expect(next.owed).toMatchObject({ youOwe: 3500 });
	});

	// Postgres refuses any write in a read-only transaction (25006). The write
	// is tried on the very transaction the snapshot reads in; without SET
	// TRANSACTION READ ONLY it would succeed and the snapshot would resolve.
	it("reads in a read-only transaction", async () => {
		const alice = (await createTestUser()).user.id;
		between.run = async (tx) => {
			between.run = null;
			await (tx as typeof adminDb).user.update({
				where: { id: alice },
				data: { homeCurrency: "EUR" },
			});
		};
		try {
			await expect(readShareSnapshot(adminDb, alice)).rejects.toThrow(
				/read-only transaction|25006/,
			);
		} finally {
			between.run = null;
		}
		const user = await adminDb.user.findUniqueOrThrow({ where: { id: alice } });
		expect(user.homeCurrency).not.toBe("EUR");
	});
});
