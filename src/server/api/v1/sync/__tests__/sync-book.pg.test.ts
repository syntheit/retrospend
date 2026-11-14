/**
 * GET /api/v1/sync/{budget-books,envelope-groups,envelopes,envelope-categories,
 * budget-movements,book-periods,month-closes,income-rules,income-rule-runs,
 * payoff-plans,wealth-transfers,envelope-changes} on Postgres (E2EE lane P,
 * P14c), through the handler the Next route uses: the scope, the raw columns
 * (and the server's own columns that must not appear), sealed text in the
 * clear, the cursor, a book that stops being personal, a deleted book and other
 * users. Values come from the rows seedBook writes.
 */
import { randomUUID } from "node:crypto";
import { contract, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type SeededBook,
	seedBook,
} from "~/server/services/sync/sync-book-test-support";
import { until } from "~/server/services/sync/sync-test-support";
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

type Row = Record<string, unknown>;
type Page = {
	items: Row[];
	tombstones: { id: string; deletedAt: string }[];
	cursor: string;
	hasMore: boolean;
};

const ROUTES = {
	books: { path: "/sync/budget-books", route: contract.sync.budgetBooks },
	groups: {
		path: "/sync/envelope-groups",
		route: contract.sync.envelopeGroups,
	},
	envelopes: { path: "/sync/envelopes", route: contract.sync.envelopes },
	links: {
		path: "/sync/envelope-categories",
		route: contract.sync.envelopeCategories,
	},
	movements: {
		path: "/sync/budget-movements",
		route: contract.sync.budgetMovements,
	},
	periods: { path: "/sync/book-periods", route: contract.sync.bookPeriods },
	closes: { path: "/sync/month-closes", route: contract.sync.monthCloses },
	rules: { path: "/sync/income-rules", route: contract.sync.incomeRules },
	runs: {
		path: "/sync/income-rule-runs",
		route: contract.sync.incomeRuleRuns,
	},
	plans: { path: "/sync/payoff-plans", route: contract.sync.payoffPlans },
	wealth: {
		path: "/sync/wealth-transfers",
		route: contract.sync.wealthTransfers,
	},
	changes: {
		path: "/sync/envelope-changes",
		route: contract.sync.envelopeChanges,
	},
} as const;

type Which = keyof typeof ROUTES;
const ALL = Object.keys(ROUTES) as Which[];

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.93" };

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

const pullUntil = (
	which: Which,
	headers: Record<string, string>,
	query: string,
	done: (page: Page) => boolean,
) => until(() => pull(which, headers, query), done);

/** A run is keyed by `expenseId`; every other row by `id`. */
const keyOf = (row: Row) => String(row.id ?? row.expenseId);
const ids = (page: Page) => page.items.map(keyOf).sort();
const tombstoneIds = (page: Page) => page.tombstones.map((t) => t.id).sort();
const hasRows = (n: number) => (p: Page) => p.items.length >= n;
const hasTombstones = (n: number) => (p: Page) => p.tombstones.length >= n;

/** The ids each route should return for a freshly seeded book. */
const expectedIds = (s: SeededBook): Record<Which, string[]> => ({
	books: [s.book],
	groups: [s.group],
	envelopes: [s.rent, s.spare].sort(),
	links: [s.spareLink],
	movements: [s.movement],
	periods: [s.period],
	closes: [s.close],
	rules: [s.rule],
	runs: [s.run],
	plans: [s.plan],
	wealth: [s.wealthTransfer],
	changes: [s.change],
});

describe("book sync routes: who may call them", () => {
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

describe("book sync routes: first pull", () => {
	let alice: string;
	let asAlice: Record<string, string>;
	let seeded: SeededBook;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		seeded = await seedBook(alice);
	});

	it("returns every row once on each route, with no tombstone", async () => {
		const expected = expectedIds(seeded);
		for (const which of ALL) {
			const page = await pullUntil(
				which,
				asAlice,
				"",
				hasRows(expected[which].length),
			);
			expect(ids(page), which).toEqual(expected[which]);
			expect(page.tombstones, which).toEqual([]);
			expect(page.hasMore, which).toBe(false);
		}
	});

	it("carries the raw columns, decimals as text and instants as ISO", async () => {
		const first = async (which: Which, id: string) =>
			(await pullUntil(which, asAlice, "", hasRows(1))).items.find(
				(r) => keyOf(r) === id,
			);

		expect(await first("books", seeded.book)).toMatchObject({
			isPersonal: true,
			currency: "ARS",
			style: "FLEX",
			fundingSource: "INCOME",
			pausedAt: null,
			weekStartDay: 1,
			monthStartDay: 1,
			timeZone: "UTC",
			timeZoneConfirmed: false,
			startDate: "2026-11-01T00:00:00.000Z",
			startMonth: 202611,
			defaultEnvelopeId: null,
			payFrequency: null,
			payAnchor: null,
		});
		expect(await first("groups", seeded.group)).toMatchObject({
			bookId: seeded.book,
			name: "Needs",
			sortOrder: 1,
			role: "BILLS",
			targetKind: "NONE",
			targetValue: null,
			archivedAt: null,
		});
		expect(await first("envelopes", seeded.rent)).toMatchObject({
			bookId: seeded.book,
			groupId: seeded.group,
			name: "Rent",
			kind: "BILL",
			targetAmount: "150000.5",
			targetMode: "REFILL",
			targetCadence: "MONTH",
			targetMonthlyAmount: null,
			targetCurrency: null,
			leftoverRule: "CARRY",
			wealthDedicated: false,
		});
		expect(await first("links", seeded.spareLink)).toMatchObject({
			bookId: seeded.book,
			envelopeId: seeded.spare,
			categoryId: seeded.category,
		});
		expect(await first("movements", seeded.movement)).toMatchObject({
			bookId: seeded.book,
			month: 202611,
			fromEnvelopeId: null,
			toEnvelopeId: seeded.rent,
			amount: "75000.25",
			kind: "ASSIGN",
			note: "Top up",
		});
		expect(await first("periods", seeded.period)).toMatchObject({
			fromMonth: 202611,
			startDay: 1,
			rateType: "blue",
		});
		expect(await first("closes", seeded.close)).toMatchObject({
			month: 202610,
			mode: "AUTO",
			revision: 1,
			summary: { closed: true },
			acknowledgedAt: null,
			recalc: null,
			lateEntries: 0,
		});
		expect(await first("rules", seeded.rule)).toMatchObject({
			name: "Salary split",
			matchKind: "ANY",
			action: "PERCENT",
			value: "20",
			envelopeId: seeded.rent,
			active: true,
		});
		expect(await first("runs", seeded.run)).toMatchObject({
			expenseId: seeded.run,
			skipped: false,
			record: { ran: true },
			fingerprint: "fp-1",
		});
		expect(await first("plans", seeded.plan)).toMatchObject({
			strategy: "AVALANCHE",
			extraMonthly: "1000",
			customOrder: ["acc-1"],
		});
		expect(await first("wealth", seeded.wealthTransfer)).toMatchObject({
			direction: "TO_WEALTH",
			envelopeId: seeded.rent,
			countOnly: true,
			date: "2026-11-05T00:00:00.000Z",
			amount: "300.5",
			note: "To the fund",
		});
		expect(await first("changes", seeded.change)).toMatchObject({
			kind: "UPDATE",
			envelopeId: seeded.rent,
			previousName: "Old rent",
			before: { targetAmount: "100" },
			undoneAt: null,
		});
		const book = await first("books", seeded.book);
		expect(book?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
		expect(book?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
	});

	it("carries every column a client can use, and none of the server's own", async () => {
		const keys = async (which: Which) =>
			Object.keys((await rawPull(which, asAlice)).items[0] ?? {}).sort();
		const own = [
			"actorUserId",
			"createdById",
			"checkpoint",
			"lastOpenedAt",
			"limitUndo",
			"styleUndo",
			"undo",
			"dirtyFromMonth",
			"legacyMigrationRunId",
			"legacyMigratedAt",
			"legacyNoticeSeenAt",
			"legacyHiddenIds",
			"userId",
		];
		for (const which of ALL) {
			const names = await keys(which);
			for (const column of own) expect(names, which).not.toContain(column);
		}
		expect(await keys("books")).toEqual(
			[
				"id",
				"name",
				"isPersonal",
				"currency",
				"style",
				"fundingSource",
				"pausedAt",
				"weekStartDay",
				"monthStartDay",
				"timeZone",
				"timeZoneConfirmed",
				"startDate",
				"startMonth",
				"defaultEnvelopeId",
				"startingBalanceExpenseId",
				"startingMoneyConfirmedAt",
				"welcomeBackFrom",
				"reconciledAt",
				"planFundFrom",
				"payFrequency",
				"payAnchor",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("groups")).toEqual(
			[
				"id",
				"bookId",
				"name",
				"sortOrder",
				"role",
				"targetKind",
				"targetValue",
				"mainEnvelopeId",
				"archivedAt",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("envelopes")).toEqual(
			[
				"id",
				"bookId",
				"groupId",
				"name",
				"icon",
				"color",
				"kind",
				"sortOrder",
				"targetAmount",
				"targetMode",
				"targetCadence",
				"targetMonthlyAmount",
				"targetCurrency",
				"targetDueDate",
				"targetRepeat",
				"targetStartMonth",
				"targetTemplateId",
				"targetLiabilityId",
				"leftoverRule",
				"leftoverSweepToId",
				"wealthAccountId",
				"wealthDedicated",
				"archivedAt",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("links")).toEqual(
			["id", "bookId", "envelopeId", "categoryId", "createdAt"].sort(),
		);
		expect(await keys("movements")).toEqual(
			[
				"id",
				"bookId",
				"month",
				"fromEnvelopeId",
				"toEnvelopeId",
				"amount",
				"kind",
				"batchId",
				"revertsId",
				"sourceExpenseId",
				"ruleId",
				"note",
				"createdAt",
			].sort(),
		);
		expect(await keys("periods")).toEqual(
			["id", "bookId", "fromMonth", "startDay", "rateType", "createdAt"].sort(),
		);
		expect(await keys("closes")).toEqual(
			[
				"id",
				"bookId",
				"month",
				"mode",
				"closedAt",
				"revision",
				"summary",
				"acknowledgedAt",
				"ackRevision",
				"recalc",
				"lateEntries",
			].sort(),
		);
		expect(await keys("rules")).toEqual(
			[
				"id",
				"bookId",
				"sortOrder",
				"name",
				"matchKind",
				"matchValue",
				"matchTitle",
				"action",
				"value",
				"envelopeId",
				"active",
				"archivedAt",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("runs")).toEqual(
			[
				"expenseId",
				"bookId",
				"batchId",
				"skipped",
				"record",
				"fingerprint",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("plans")).toEqual(
			[
				"id",
				"bookId",
				"strategy",
				"extraMonthly",
				"customOrder",
				"envelopeId",
				"createdAt",
				"updatedAt",
			].sort(),
		);
		expect(await keys("wealth")).toEqual(
			[
				"id",
				"bookId",
				"direction",
				"envelopeId",
				"transferId",
				"sourceExpenseId",
				"assetAccountId",
				"countOnly",
				"date",
				"amount",
				"note",
				"createdAt",
			].sort(),
		);
		expect(await keys("changes")).toEqual(
			[
				"id",
				"bookId",
				"kind",
				"envelopeId",
				"previousName",
				"before",
				"createdAt",
				"undoneAt",
			].sort(),
		);
	});

	it("opens sealed names and notes: they come back as typed", async () => {
		const stored = await adminDb.$queryRaw<{ name: string }[]>`
			SELECT "name" FROM "envelope" WHERE "id" = ${seeded.rent}`;
		// With sealing on the column holds ciphertext, so the route must open it.
		if (sealedSuite) expect(stored[0]?.name).not.toBe("Rent");
		else expect(stored[0]?.name).toBe("Rent");

		const names = async (which: Which, field: string) =>
			(await pullUntil(which, asAlice, "", hasRows(1))).items.map(
				(r) => r[field],
			);
		expect(await names("envelopes", "name")).toContain("Rent");
		expect(await names("groups", "name")).toEqual(["Needs"]);
		expect(await names("rules", "name")).toEqual(["Salary split"]);
		expect(await names("movements", "note")).toEqual(["Top up"]);
		expect(await names("wealth", "note")).toEqual(["To the fund"]);
		expect(await names("changes", "previousName")).toEqual(["Old rent"]);
		const books = await names("books", "name");
		expect(String(books[0])).toMatch(/^Home /);
	});

	it("round trips the cursor on every route: a caught-up pull is empty and steady", async () => {
		for (const which of ALL) {
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
});

describe("book sync routes: changes", () => {
	it("an app write comes back changed, a new row comes once, a delete is a tombstone", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedBook(user);
		const firstEnvelopes = await pullUntil(
			"envelopes",
			headers,
			"",
			hasRows(2),
		);
		const firstMovements = await pullUntil(
			"movements",
			headers,
			"",
			hasRows(1),
		);

		await fixtureDb.envelope.update({
			where: { id: s.rent },
			data: { sortOrder: 7, targetAmount: "200" },
		});
		const fresh = randomUUID();
		await fixtureDb.budgetMovement.create({
			data: {
				id: fresh,
				bookId: s.book,
				month: 202611,
				toEnvelopeId: s.rent,
				amount: "12.5",
				kind: "ASSIGN",
				actorUserId: user,
			},
		});
		await adminDb.envelope.delete({ where: { id: s.spare } });

		const envelopes = await pullUntil(
			"envelopes",
			headers,
			`?since=${firstEnvelopes.cursor}`,
			(p) => p.items.length >= 1 && p.tombstones.length >= 1,
		);
		expect(ids(envelopes)).toEqual([s.rent]);
		expect(envelopes.items[0]).toMatchObject({
			sortOrder: 7,
			targetAmount: "200",
		});
		expect(tombstoneIds(envelopes)).toEqual([s.spare]);
		// The category link went with the envelope.
		const links = await pullUntil("links", headers, "", hasTombstones(1));
		expect(tombstoneIds(links)).toEqual([s.spareLink]);

		const movements = await pullUntil(
			"movements",
			headers,
			`?since=${firstMovements.cursor}`,
			hasRows(1),
		);
		expect(ids(movements)).toEqual([fresh]);
		expect(movements.items[0]?.amount).toBe("12.5");
	});

	it("a touchOpened-style write moves the book's updatedAt and the pull carries the new one; a cache written in SQL brings nothing", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedBook(user);
		const first = await pullUntil("books", headers, "", hasRows(1));
		const before = String(first.items[0]?.updatedAt);

		await adminDb.$executeRaw`
			UPDATE "budget_book" SET "dirtyFromMonth" = 202610 WHERE "id" = ${s.book}`;
		await new Promise((resolve) => setTimeout(resolve, 50));
		const quiet = await pull("books", headers, `?since=${first.cursor}`);
		expect(quiet.items).toEqual([]);

		await fixtureDb.budgetBook.update({
			where: { id: s.book },
			data: { lastOpenedAt: new Date() },
		});
		const next = await pullUntil(
			"books",
			headers,
			`?since=${first.cursor}`,
			hasRows(1),
		);
		expect(ids(next)).toEqual([s.book]);
		expect(Date.parse(String(next.items[0]?.updatedAt))).toBeGreaterThan(
			Date.parse(before),
		);
		expect(next.items[0]).not.toHaveProperty("lastOpenedAt");
	});

	it("pages with limit and hasMore, each movement once", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedBook(user);
		const made: string[] = [s.movement];
		for (let i = 0; i < 4; i++) {
			const id = randomUUID();
			made.push(id);
			await fixtureDb.budgetMovement.create({
				data: {
					id,
					bookId: s.book,
					month: 202611,
					toEnvelopeId: s.rent,
					amount: `${i + 1}`,
					kind: "ASSIGN",
					actorUserId: user,
				},
			});
		}
		const seen: string[] = [];
		let since = "";
		for (let pages = 0; pages < 20; pages++) {
			const page = await pullUntil(
				"movements",
				headers,
				`?limit=2${since}`,
				(p) => p.items.length > 0,
			);
			expect(page.items.length).toBeLessThanOrEqual(2);
			seen.push(...page.items.map(keyOf));
			since = `&since=${page.cursor}`;
			// hasMore false means caught up for now: rows behind an open
			// transaction (another test file, under load) come on a later pull.
			if (!page.hasMore && seen.length >= made.length) break;
		}
		expect(seen.sort()).toEqual([...made].sort());
	});
});

describe("book sync routes: a book that stops being personal", () => {
	it("gives the creator a tombstone for every row, on every route, then rows again when the member leaves", async () => {
		const owner = (await createTestUser()).user.id;
		const guest = (await createTestUser()).user.id;
		const asOwner = await asMobile(owner);
		const asGuest = await asMobile(guest);
		const s = await seedBook(owner);
		const expected = expectedIds(s);
		const first: Record<string, Page> = {};
		for (const which of ALL)
			first[which] = await pullUntil(
				which,
				asOwner,
				"",
				hasRows(expected[which].length),
			);

		const member = await fixtureDb.budgetMember.create({
			data: { bookId: s.book, userId: guest, role: "EDITOR" },
		});

		for (const which of ALL) {
			const after = await pullUntil(
				which,
				asOwner,
				`?since=${first[which]?.cursor}`,
				hasTombstones(expected[which].length),
			);
			expect(tombstoneIds(after), which).toEqual(expected[which]);
			expect(after.items, which).toEqual([]);
			// A first pull sees the same: nothing live, a tombstone for each.
			const fresh = await pullUntil(
				which,
				asOwner,
				"",
				hasTombstones(expected[which].length),
			);
			expect(fresh.items, which).toEqual([]);
			expect(tombstoneIds(fresh), which).toEqual(expected[which]);
			// The member never sees the creator's rows, as items or tombstones.
			const theirs = await pull(which, asGuest);
			expect(theirs.items, which).toEqual([]);
			expect(theirs.tombstones, which).toEqual([]);
		}

		await adminDb.budgetMember.delete({ where: { id: member.id } });
		for (const which of ALL) {
			const back = await pullUntil(
				which,
				asOwner,
				"",
				hasRows(expected[which].length),
			);
			expect(ids(back), which).toEqual(expected[which]);
			expect(back.tombstones, which).toEqual([]);
		}
	});

	it("a row stamped U before the book was shared still reads as deleted if the book is shared by the time it is read", async () => {
		const owner = (await createTestUser()).user.id;
		const guest = (await createTestUser()).user.id;
		const headers = await asMobile(owner);
		const s = await seedBook(owner);
		await pullUntil("envelopes", headers, "", hasRows(2));
		// Share the book without the trigger's help: a quiet member insert as
		// the superuser path would be, so the stamps still say U.
		await adminDb.$transaction(async (tx) => {
			await tx.$executeRaw`ALTER TABLE "budget_member" DISABLE TRIGGER "sync_budget_member_ins"`;
			await tx.budgetMember.create({
				data: { bookId: s.book, userId: guest, role: "EDITOR" },
			});
			await tx.$executeRaw`ALTER TABLE "budget_member" ENABLE TRIGGER "sync_budget_member_ins"`;
		});
		const page = await pullUntil("envelopes", headers, "", hasTombstones(2));
		expect(page.items).toEqual([]);
		expect(tombstoneIds(page)).toEqual([s.rent, s.spare].sort());
	});
});

describe("book sync routes: a deleted book and other users", () => {
	it("deleting the book is a tombstone on every route, the book's own included", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const s = await seedBook(user);
		const expected = expectedIds(s);
		const first: Record<string, Page> = {};
		for (const which of ALL)
			first[which] = await pullUntil(
				which,
				headers,
				"",
				hasRows(expected[which].length),
			);
		await adminDb.budgetBook.delete({ where: { id: s.book } });
		for (const which of ALL) {
			const after = await pullUntil(
				which,
				headers,
				`?since=${first[which]?.cursor}`,
				hasTombstones(expected[which].length),
			);
			expect(tombstoneIds(after), which).toEqual(expected[which]);
			expect(after.items, which).toEqual([]);
		}
	});

	it("never show another user's rows or deletes, even with their cursor", async () => {
		const alice = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		const asAlice = await asMobile(alice);
		const asBob = await asMobile(bob);
		const mine = await seedBook(alice);
		const theirs = await seedBook(bob);
		const expectedMine = expectedIds(mine);
		const expectedTheirs = expectedIds(theirs);

		for (const which of ALL) {
			const a = await pullUntil(
				which,
				asAlice,
				"",
				hasRows(expectedMine[which].length),
			);
			const b = await pullUntil(
				which,
				asBob,
				"",
				hasRows(expectedTheirs[which].length),
			);
			expect(ids(a), which).toEqual(expectedMine[which]);
			expect(ids(b), which).toEqual(expectedTheirs[which]);
		}
		const aliceFirst = await pull("envelopes", asAlice);
		await adminDb.envelope.delete({ where: { id: mine.spare } });
		await pullUntil(
			"envelopes",
			asAlice,
			`?since=${aliceFirst.cursor}`,
			hasTombstones(1),
		);
		// Bob, holding Alice's cursor, sees nothing of her delete.
		const bobWithAlices = await pull(
			"envelopes",
			asBob,
			`?since=${aliceFirst.cursor}`,
		);
		expect(bobWithAlices.tombstones).toEqual([]);
		expect(ids(bobWithAlices)).not.toContain(mine.spare);
	});
});
