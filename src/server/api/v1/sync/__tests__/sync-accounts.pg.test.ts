/**
 * GET /api/v1/sync/{accounts,account-snapshots,account-legs,account-history,
 * account-rate-types,transfers} on Postgres (E2EE lane P, P14b2), through the
 * handler the Next route uses: the raw columns, the cascade of an account
 * delete, the balance trigger's changes, the cursor, the scope, other users
 * and sealed names. Values are derived by hand from the rows seedPersonal
 * writes: account Cash holds 1000, its transfer leg of -50 moves it to 950.
 */
import { contract, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	DAY,
	seedPersonal,
	until,
} from "~/server/services/sync/sync-test-support";
import { sealedSuite } from "~/test/pg-harness";
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

type Row = { id: string } & Record<string, unknown>;
type Page = {
	items: Row[];
	tombstones: { id: string; deletedAt: string }[];
	cursor: string;
	hasMore: boolean;
};

const ROUTES = {
	accounts: { path: "/sync/accounts", route: contract.sync.accounts },
	snapshots: {
		path: "/sync/account-snapshots",
		route: contract.sync.accountSnapshots,
	},
	legs: { path: "/sync/account-legs", route: contract.sync.accountLegs },
	history: {
		path: "/sync/account-history",
		route: contract.sync.accountHistory,
	},
	rateTypes: {
		path: "/sync/account-rate-types",
		route: contract.sync.accountRateTypes,
	},
	transfers: { path: "/sync/transfers", route: contract.sync.transfers },
} as const;

type Which = keyof typeof ROUTES;

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.92" };

const pull = async (
	which: Which,
	headers: Record<string, string>,
	query = "",
) => {
	const { path, route } = ROUTES[which];
	return expectBody<Page>(
		await call(`${path}${query}`, { headers: { ...OWN_IP, ...headers } }),
		route,
	);
};

/** The raw JSON of a page, to see keys the output schema would strip. */
const rawPull = async (which: Which, headers: Record<string, string>) =>
	(await (
		await call(ROUTES[which].path, { headers: { ...OWN_IP, ...headers } })
	).json()) as Page;

/** Pulls until `done` accepts the page: a change shows once older transactions end. */
const pullUntil = (
	which: Which,
	headers: Record<string, string>,
	query: string,
	done: (page: Page) => boolean,
) => until(() => pull(which, headers, query), done);

const ids = (page: Page) => page.items.map((r) => r.id).sort();
const tombstoneIds = (page: Page) => page.tombstones.map((t) => t.id).sort();
const hasRows = (n: number) => (p: Page) => p.items.length >= n;

describe("account sync routes: who may call them", () => {
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it.each(Object.entries(ROUTES))(
		"%s answers a mobile app session",
		async (_name, { path }) => {
			const res = await call(path, {
				headers: { ...OWN_IP, ...(await asMobile(userId)) },
			});
			expect(res.status, await res.text()).toBe(200);
		},
	);

	it.each(Object.entries(ROUTES))(
		"%s needs credentials and refuses a key with every token scope",
		async (_name, { path }) => {
			await expectProblem(
				await call(path, { headers: OWN_IP }),
				401,
				"unauthenticated",
			);
			const res = await call(path, {
				headers: { ...OWN_IP, ...(await asKey(userId, [...SCOPES])) },
			});
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({
				code: "missing_scope",
				requiredScope: "sync",
			});
		},
	);

	it.each(Object.entries(ROUTES))(
		"%s refuses the web app's cookie session",
		async (_name, { path }) => {
			const res = await call(path, {
				headers: { ...OWN_IP, ...(await webCookieFor(userId)) },
			});
			await expectProblem(res, 403, "missing_scope");
		},
	);
});

describe("account sync routes: first pull", () => {
	let alice: string;
	let asAlice: Record<string, string>;
	let seeded: Awaited<ReturnType<typeof seedPersonal>>;
	let snapshotId: string;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		seeded = await seedPersonal(alice);
		snapshotId = (
			await adminDb.assetSnapshot.findFirstOrThrow({
				where: { accountId: seeded.account },
			})
		).id;
	});

	it("returns every row once on each route", async () => {
		const accounts = await pullUntil("accounts", asAlice, "", hasRows(2));
		expect(ids(accounts)).toEqual([seeded.account, seeded.other].sort());
		expect(accounts.tombstones).toEqual([]);
		expect(accounts.hasMore).toBe(false);
		const expected = {
			snapshots: [snapshotId],
			legs: [seeded.leg],
			history: [seeded.history],
			rateTypes: [seeded.rateType],
			transfers: [seeded.transfer],
		} as const;
		for (const which of Object.keys(expected) as (keyof typeof expected)[]) {
			const page = await pullUntil(which, asAlice, "", hasRows(1));
			expect(ids(page), which).toEqual(expected[which]);
			expect(page.tombstones, which).toEqual([]);
		}
	});

	it("carries the raw account columns, decimals as text and instants as ISO", async () => {
		const page = await pullUntil("accounts", asAlice, "", hasRows(2));
		const cash = page.items.find((r) => r.id === seeded.account);
		// 1000 held, the seed leg of -50 moved it to 950.
		expect(cash).toMatchObject({
			name: "Cash",
			type: "CASH",
			currency: "ARS",
			balance: "950",
			exchangeRate: null,
			exchangeRateType: null,
			isLiquid: false,
			interestRate: null,
			minimumPayment: null,
			dueDate: null,
			inBudget: null,
			countedUnits: "0",
			closedAt: null,
			iconKind: null,
			iconValue: null,
		});
		expect(cash?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
		expect(cash?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
	});

	it("carries the raw columns of the other five", async () => {
		const snapshot = (await pullUntil("snapshots", asAlice, "", hasRows(1)))
			.items[0];
		expect(snapshot).toMatchObject({
			accountId: seeded.account,
			date: DAY.toISOString(),
			balance: "1000",
			balanceInUSD: "0.68",
			currency: null,
			type: null,
			exchangeRateType: null,
		});
		expect(snapshot?.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);

		const leg = (await pullUntil("legs", asAlice, "", hasRows(1))).items[0];
		expect(leg).toMatchObject({
			accountId: seeded.account,
			currency: "ARS",
			amount: "-50",
			homeAmount: null,
			homeCurrency: null,
			date: DAY.toISOString(),
			source: "TRANSFER",
			transferId: seeded.transfer,
			expenseId: null,
			countedUnits: "0",
		});

		const history = (await pullUntil("history", asAlice, "", hasRows(1)))
			.items[0];
		expect(history).toMatchObject({
			assetId: seeded.account,
			balance: "1000",
		});

		const rateType = (await pullUntil("rateTypes", asAlice, "", hasRows(1)))
			.items[0];
		expect(rateType).toMatchObject({
			accountId: seeded.account,
			from: DAY.toISOString(),
			type: "blue",
			previousType: null,
		});

		const transfer = (await pullUntil("transfers", asAlice, "", hasRows(1)))
			.items[0];
		expect(transfer).toMatchObject({
			kind: "TRANSFER",
			date: DAY.toISOString(),
			fromAccountId: seeded.account,
			fromAmount: "50",
			fromCurrency: "ARS",
			toAccountId: seeded.other,
			toAmount: "50",
			toCurrency: "ARS",
			referenceRateType: null,
			feeExpenseId: null,
			countedFromUnits: "0",
			countedToUnits: "0",
			note: null,
		});
	});

	it("carries every column but userId, and nothing else", async () => {
		const keys = async (which: Which) =>
			Object.keys((await rawPull(which, asAlice)).items[0] ?? {}).sort();
		expect(await keys("accounts")).toEqual(
			[
				"balance",
				"closedAt",
				"countedUnits",
				"createdAt",
				"currency",
				"dueDate",
				"exchangeRate",
				"exchangeRateType",
				"iconKind",
				"iconValue",
				"id",
				"inBudget",
				"interestRate",
				"isLiquid",
				"minimumPayment",
				"name",
				"type",
				"updatedAt",
			].sort(),
		);
		expect(await keys("snapshots")).toEqual(
			[
				"accountId",
				"balance",
				"balanceInUSD",
				"currency",
				"date",
				"exchangeRateType",
				"id",
				"recordedAt",
				"type",
			].sort(),
		);
		expect(await keys("legs")).toEqual(
			[
				"accountId",
				"amount",
				"countedUnits",
				"createdAt",
				"currency",
				"date",
				"expenseId",
				"homeAmount",
				"homeCurrency",
				"id",
				"source",
				"transferId",
			].sort(),
		);
		expect(await keys("history")).toEqual(
			["assetId", "balance", "id", "recordedAt"].sort(),
		);
		expect(await keys("rateTypes")).toEqual(
			["accountId", "createdAt", "from", "id", "previousType", "type"].sort(),
		);
		expect(await keys("transfers")).toEqual(
			[
				"countedFromUnits",
				"countedToUnits",
				"createdAt",
				"date",
				"feeExpenseId",
				"fromAccountId",
				"fromAmount",
				"fromCurrency",
				"id",
				"kind",
				"note",
				"referenceRateType",
				"toAccountId",
				"toAmount",
				"toCurrency",
			].sort(),
		);
	});

	it("round trips the cursor on every route: a caught-up pull is empty and steady", async () => {
		for (const which of Object.keys(ROUTES) as Which[]) {
			const first = await pullUntil(which, asAlice, "", hasRows(1));
			const again = await pull(which, asAlice, `?since=${first.cursor}`);
			expect(again, which).toMatchObject({
				items: [],
				tombstones: [],
				hasMore: false,
			});
			const third = await pull(which, asAlice, `?since=${again.cursor}`);
			expect(third.items, which).toEqual([]);
		}
	});

	it("opens a sealed account name and transfer note: they come back as typed", async () => {
		const stored = await adminDb.$queryRaw<{ name: string }[]>`
			SELECT "name" FROM "asset_account" WHERE "id" = ${seeded.account}`;
		// With sealing on the column holds ciphertext, so the route must open it.
		if (sealedSuite) expect(stored[0]?.name).not.toBe("Cash");
		else expect(stored[0]?.name).toBe("Cash");

		await fixtureDb.transfer.update({
			where: { id: seeded.transfer },
			data: { note: "Rent share" },
		});
		const accounts = await pullUntil("accounts", asAlice, "", hasRows(2));
		expect(accounts.items.map((r) => r.name).sort()).toEqual([
			"Cash",
			"Savings",
		]);
		const transfers = await pullUntil(
			"transfers",
			asAlice,
			"",
			(p) => p.items[0]?.note === "Rent share",
		);
		expect(transfers.items[0]?.note).toBe("Rent share");
	});
});

describe("account sync routes: changes", () => {
	it("a leg insert brings the account and its snapshot back changed by the balance trigger", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedPersonal(user);
		const firstAccounts = await pullUntil("accounts", headers, "", hasRows(2));
		const firstSnapshots = await pullUntil(
			"snapshots",
			headers,
			"",
			hasRows(1),
		);
		const firstLegs = await pullUntil("legs", headers, "", hasRows(1));
		const snapshotId = firstSnapshots.items[0]?.id as string;
		expect(firstSnapshots.items[0]?.balance).toBe("1000");

		const legId = await userTransaction(adminDb, user, async (tx) => {
			const leg = await tx.accountLeg.create({
				data: {
					userId: user,
					accountId: s.account,
					currency: "ARS",
					amount: "25",
					date: DAY,
					source: "TRANSFER",
					transferId: s.transfer,
					// Before the snapshot was recorded, so the trigger moves it too.
					createdAt: new Date("2026-10-01T00:00:00.000Z"),
				},
			});
			return leg.id;
		});

		const legs = await pullUntil(
			"legs",
			headers,
			`?since=${firstLegs.cursor}`,
			hasRows(1),
		);
		expect(ids(legs)).toEqual([legId]);
		// By hand: 1000 - 50 (seed leg) + 25 = 975; the snapshot 1000 + 25 = 1025
		// and its USD value 0.68 * 1025 / 1000 = 0.697, rounded to 0.70.
		const accounts = await pullUntil(
			"accounts",
			headers,
			`?since=${firstAccounts.cursor}`,
			hasRows(1),
		);
		expect(ids(accounts)).toEqual([s.account]);
		expect(accounts.items[0]?.balance).toBe("975");
		const snapshots = await pullUntil(
			"snapshots",
			headers,
			`?since=${firstSnapshots.cursor}`,
			hasRows(1),
		);
		expect(ids(snapshots)).toEqual([snapshotId]);
		expect(snapshots.items[0]).toMatchObject({
			balance: "1025",
			balanceInUSD: "0.7",
		});
	});

	it("deleting an account tombstones its snapshots, legs, history and rate types, and frees the transfer's side", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedPersonal(user);
		const snapshotIds = (
			await adminDb.assetSnapshot.findMany({ where: { accountId: s.account } })
		).map((r) => r.id);
		const first = {
			accounts: await pullUntil("accounts", headers, "", hasRows(2)),
			snapshots: await pullUntil("snapshots", headers, "", hasRows(1)),
			legs: await pullUntil("legs", headers, "", hasRows(1)),
			history: await pullUntil("history", headers, "", hasRows(1)),
			rateTypes: await pullUntil("rateTypes", headers, "", hasRows(1)),
			transfers: await pullUntil("transfers", headers, "", hasRows(1)),
		};

		await fixtureDb.assetAccount.delete({ where: { id: s.account } });

		const pullAfter = async (
			which: keyof typeof first,
			done: (p: Page) => boolean,
		) => pullUntil(which, headers, `?since=${first[which].cursor}`, done);
		const tombstoned = (n: number) => (p: Page) => p.tombstones.length >= n;

		const accounts = await pullAfter("accounts", tombstoned(1));
		expect(tombstoneIds(accounts)).toEqual([s.account]);
		expect(accounts.items.map((r) => r.id)).not.toContain(s.account);
		expect(tombstoneIds(await pullAfter("snapshots", tombstoned(1)))).toEqual(
			[...snapshotIds].sort(),
		);
		expect(tombstoneIds(await pullAfter("legs", tombstoned(1)))).toEqual([
			s.leg,
		]);
		expect(tombstoneIds(await pullAfter("history", tombstoned(1)))).toEqual([
			s.history,
		]);
		expect(tombstoneIds(await pullAfter("rateTypes", tombstoned(1)))).toEqual([
			s.rateType,
		]);
		// The transfer stays; its source account is now Not tracked (SET NULL).
		const transfers = await pullAfter("transfers", hasRows(1));
		expect(transfers.tombstones).toEqual([]);
		expect(ids(transfers)).toEqual([s.transfer]);
		expect(transfers.items[0]).toMatchObject({
			fromAccountId: null,
			toAccountId: s.other,
		});
		// Deleting the transfer then tombstones it.
		await fixtureDb.transfer.delete({ where: { id: s.transfer } });
		const gone = await pullUntil(
			"transfers",
			headers,
			`?since=${transfers.cursor}`,
			tombstoned(1),
		);
		expect(tombstoneIds(gone)).toEqual([s.transfer]);
		expect(gone.items).toEqual([]);
	});

	it("pages with limit and hasMore, each account once", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const made: string[] = [];
		for (let i = 0; i < 5; i++) {
			made.push(
				(
					await fixtureDb.assetAccount.create({
						data: {
							userId: user,
							name: `Acct ${i}`,
							type: "CASH",
							currency: "ARS",
							balance: "1",
						},
						select: { id: true },
					})
				).id,
			);
		}
		const seen: string[] = [];
		let since = "";
		for (let pages = 0; pages < 20; pages++) {
			const page = await pullUntil(
				"accounts",
				headers,
				`?limit=2${since}`,
				(p) => p.items.length > 0,
			);
			expect(page.items.length).toBeLessThanOrEqual(2);
			seen.push(...page.items.map((r) => r.id));
			since = `&since=${page.cursor}`;
			if (!page.hasMore) break;
		}
		expect(seen.sort()).toEqual([...made].sort());
	});
});

describe("account sync routes: other users", () => {
	it("never show another user's rows or deletes, even with their cursor", async () => {
		const alice = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		const asAlice = await asMobile(alice);
		const asBob = await asMobile(bob);
		const mine = await seedPersonal(alice);
		const theirs = await seedPersonal(bob);

		const aliceFirst = await pullUntil("accounts", asAlice, "", hasRows(2));
		const bobFirst = await pullUntil("accounts", asBob, "", hasRows(2));
		expect(ids(aliceFirst)).toEqual([mine.account, mine.other].sort());
		expect(ids(bobFirst)).toEqual([theirs.account, theirs.other].sort());

		const mySnapshots = (
			await adminDb.assetSnapshot.findMany({ where: { userId: alice } })
		).map((r) => r.id);
		await fixtureDb.assetAccount.delete({ where: { id: mine.account } });
		await pullUntil(
			"accounts",
			asAlice,
			`?since=${aliceFirst.cursor}`,
			(p) => p.tombstones.length >= 1,
		);
		// Bob, holding Alice's cursor, sees nothing of her delete.
		const bobWithAlices = await pull(
			"accounts",
			asBob,
			`?since=${aliceFirst.cursor}`,
		);
		expect(bobWithAlices.tombstones).toEqual([]);
		expect(ids(bobWithAlices)).not.toContain(mine.account);

		const mineByRoute = {
			snapshots: mySnapshots,
			legs: [mine.leg],
			history: [mine.history],
			rateTypes: [mine.rateType],
			transfers: [mine.transfer],
		};
		for (const which of Object.keys(
			mineByRoute,
		) as (keyof typeof mineByRoute)[]) {
			const page = await pullUntil(which, asBob, "", hasRows(1));
			for (const id of mineByRoute[which]) {
				expect(ids(page), which).not.toContain(id);
				expect(tombstoneIds(page), which).not.toContain(id);
			}
		}
	});
});
