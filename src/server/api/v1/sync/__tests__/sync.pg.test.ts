/**
 * GET /api/v1/sync/{expenses,categories,recurring-templates} on Postgres
 * (E2EE lane P, P14b1), through the handler the Next route uses: who may call
 * it, what a first pull and a delta return, the cursor, what makes a cursor
 * stale, sealed text coming back plain, and isolation between users. Values
 * are derived by hand from the rows each test writes.
 */
import { contract, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "~/server/services/api-v1/cursor";
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
	sessionFor,
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
	expenses: { path: "/sync/expenses", route: contract.sync.expenses },
	categories: { path: "/sync/categories", route: contract.sync.categories },
	templates: {
		path: "/sync/recurring-templates",
		route: contract.sync.recurringTemplates,
	},
} as const;

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.91" };

const pull = async (
	which: keyof typeof ROUTES,
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
const rawPull = async (path: string, headers: Record<string, string>) =>
	(await (
		await call(path, { headers: { ...OWN_IP, ...headers } })
	).json()) as Page;

/** Pulls until `done` accepts the page: a change shows once older transactions end. */
const pullUntil = (
	which: keyof typeof ROUTES,
	headers: Record<string, string>,
	query: string,
	done: (page: Page) => boolean,
) => until(() => pull(which, headers, query), done);

const ids = (page: Page) => page.items.map((r) => r.id).sort();

describe("sync routes: who may call them", () => {
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
	});

	it("needs credentials", async () => {
		await expectProblem(
			await call("/sync/expenses", { headers: OWN_IP }),
			401,
			"unauthenticated",
		);
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
		"%s refuses an API key with every token scope",
		async (_name, { path }) => {
			const res = await call(path, {
				headers: { ...OWN_IP, ...(await asKey(userId, [...SCOPES])) },
			});
			await expectProblem(res, 403, "missing_scope");
		},
	);

	it("names the sync scope in the refusal", async () => {
		const res = await call("/sync/expenses", {
			headers: { ...OWN_IP, ...(await asKey(userId, ["read"])) },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "missing_scope",
			requiredScope: "sync",
		});
	});

	it("refuses a third-party device token that holds read", async () => {
		const token = await sessionFor(userId, {
			scopes: "read",
			clientId: "retrospend-cli",
		});
		const res = await call("/sync/expenses", {
			headers: { ...OWN_IP, authorization: `Bearer ${token}` },
		});
		await expectProblem(res, 403, "missing_scope");
	});

	it("refuses the web app's cookie session", async () => {
		const res = await call("/sync/expenses", {
			headers: { ...OWN_IP, ...(await webCookieFor(userId)) },
		});
		await expectProblem(res, 403, "missing_scope");
	});

	it("refuses a mobile session whose stored scopes lack read", async () => {
		const token = await sessionFor(userId, {
			scopes: "write:expenses write:settings",
			clientId: "retrospend-mobile",
		});
		const res = await call("/sync/expenses", {
			headers: { ...OWN_IP, authorization: `Bearer ${token}` },
		});
		await expectProblem(res, 403, "missing_scope");
	});
});

describe("sync routes: pulls", () => {
	let alice: string;
	let asAlice: Record<string, string>;
	let seeded: Awaited<ReturnType<typeof seedPersonal>>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		seeded = await seedPersonal(alice);
	});

	it("returns every row once on the first pull", async () => {
		const expenses = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(ids(expenses)).toEqual([seeded.expense]);
		expect(expenses.tombstones).toEqual([]);
		expect(expenses.hasMore).toBe(false);

		const categories = await pullUntil(
			"categories",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(ids(categories)).toEqual([seeded.category]);

		const templates = await pullUntil(
			"templates",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(ids(templates)).toEqual([seeded.template]);
	});

	it("carries the raw columns, decimals as text and instants as ISO", async () => {
		const page = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(page.items[0]).toMatchObject({
			id: seeded.expense,
			title: "Coffee",
			amount: "100",
			currency: "ARS",
			date: DAY.toISOString(),
			categoryId: seeded.category,
			recurringTemplateId: seeded.template,
			amountInUSD: "0.07",
			exchangeRate: "1468",
			pricingSource: "MANUAL",
			location: null,
			status: "FINALIZED",
			direction: "OUT",
			entryKind: "STANDARD",
			inType: null,
			homeRate: null,
			homeAmount: null,
			importFingerprint: null,
		});
		expect(page.items[0]?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
		const templates = await pullUntil(
			"templates",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(templates.items[0]).toMatchObject({
			name: "Rent",
			amount: "100",
			frequency: "MONTHLY",
			nextDueDate: DAY.toISOString(),
			anchorDay: null,
			autoPay: true,
			isActive: true,
		});
	});

	it("leaves the server-only columns out", async () => {
		await pullUntil("categories", asAlice, "", (p) => p.items.length >= 1);
		const raw = await rawPull("/sync/categories", asAlice);
		expect(Object.keys(raw.items[0] ?? {}).sort()).toEqual([
			"color",
			"excludeByDefault",
			"icon",
			"id",
			"isFixed",
			"kind",
			"name",
		]);
		const expense = (await rawPull("/sync/expenses", asAlice)).items[0] ?? {};
		expect(expense).not.toHaveProperty("userId");
	});

	it("brings a deleted row as a tombstone and nothing else", async () => {
		const first = await pullUntil(
			"templates",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		const gone = await fixtureDb.recurringTemplate.create({
			data: {
				userId: alice,
				name: "Gym",
				amount: "5",
				frequency: "WEEKLY",
				nextDueDate: DAY,
			},
		});
		const added = await pullUntil(
			"templates",
			asAlice,
			`?since=${first.cursor}`,
			(p) => p.items.length >= 1,
		);
		expect(ids(added)).toEqual([gone.id]);
		await fixtureDb.recurringTemplate.delete({ where: { id: gone.id } });
		const after = await pullUntil(
			"templates",
			asAlice,
			`?since=${added.cursor}`,
			(p) => p.tombstones.length >= 1,
		);
		expect(after.items).toEqual([]);
		expect(after.tombstones.map((t) => t.id)).toEqual([gone.id]);
		expect(after.tombstones[0]?.deletedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
	});

	it("round trips the cursor: a caught-up pull is empty and steady", async () => {
		const first = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		const again = await pull("expenses", asAlice, `?since=${first.cursor}`);
		expect(again).toMatchObject({ items: [], tombstones: [], hasMore: false });
		const third = await pull("expenses", asAlice, `?since=${again.cursor}`);
		expect(third.items).toEqual([]);
	});

	it("pages with limit and hasMore, each row once", async () => {
		const user = (await createTestUser()).user.id;
		const headers = await asMobile(user);
		const made: string[] = [];
		for (let i = 0; i < 5; i++) {
			made.push(
				(
					await fixtureDb.expense.create({
						data: {
							userId: user,
							title: `Row ${i}`,
							amount: "1",
							currency: "ARS",
							date: DAY,
							amountInUSD: "0.01",
							exchangeRate: "1468",
							pricingSource: "MANUAL",
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
				"expenses",
				headers,
				`?limit=2${since}`,
				(p) => p.items.length > 0,
			);
			expect(page.items.length).toBeLessThanOrEqual(2);
			seen.push(...page.items.map((r) => r.id));
			since = `&since=${page.cursor}`;
			// hasMore false means caught up for now: rows behind an open
			// transaction (another test file, under load) come on a later pull.
			if (!page.hasMore && seen.length >= made.length) break;
		}
		expect(seen.sort()).toEqual([...made].sort());
	});

	it("answers 400 for a malformed cursor or limit", async () => {
		await expectProblem(
			await call("/sync/expenses?since=not-a-cursor", {
				headers: { ...OWN_IP, ...asAlice },
			}),
			400,
			"bad_request",
		);
		await expectProblem(
			await call("/sync/expenses?limit=501", {
				headers: { ...OWN_IP, ...asAlice },
			}),
			400,
			"validation_failed",
		);
	});

	it("answers 410 sync_reset_required for an epoch the log does not know", async () => {
		const since = encodeCursor({ e: "another-epoch", t: "1", s: "1" });
		await expectProblem(
			await call(`/sync/expenses?since=${since}`, {
				headers: { ...OWN_IP, ...asAlice },
			}),
			410,
			"sync_reset_required",
		);
	});

	it("answers 410 for a position this cluster has not reached", async () => {
		const first = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		const real = JSON.parse(
			Buffer.from(first.cursor, "base64url").toString("utf8"),
		) as { e: string };
		const since = encodeCursor({
			e: real.e,
			t: "18446744073709551615",
			s: "1",
		});
		await expectProblem(
			await call(`/sync/expenses?since=${since}`, {
				headers: { ...OWN_IP, ...asAlice },
			}),
			410,
			"sync_reset_required",
		);
	});

	it("opens a sealed title: it comes back as typed", async () => {
		const stored = await adminDb.$queryRaw<{ title: string }[]>`
			SELECT "title" FROM "expense" WHERE "id" = ${seeded.expense}`;
		// With sealing on the column holds ciphertext, so the route must open it.
		if (sealedSuite) expect(stored[0]?.title).not.toBe("Coffee");
		else expect(stored[0]?.title).toBe("Coffee");
		const page = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(page.items[0]?.title).toBe("Coffee");
		const categories = await pullUntil(
			"categories",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		expect(categories.items[0]?.name).toMatch(/^Food /);
	});
});

describe("sync routes: other users", () => {
	it("never show another user's rows or deletes, even with their cursor", async () => {
		const alice = (await createTestUser()).user.id;
		const bob = (await createTestUser()).user.id;
		const asAlice = await asMobile(alice);
		const asBob = await asMobile(bob);
		const mine = await seedPersonal(alice);
		const theirs = await seedPersonal(bob);

		const aliceFirst = await pullUntil(
			"expenses",
			asAlice,
			"",
			(p) => p.items.length >= 1,
		);
		const bobFirst = await pullUntil(
			"expenses",
			asBob,
			"",
			(p) => p.items.length >= 1,
		);
		expect(ids(aliceFirst)).toEqual([mine.expense]);
		expect(ids(bobFirst)).toEqual([theirs.expense]);

		await fixtureDb.expense.delete({ where: { id: mine.expense } });
		await pullUntil(
			"expenses",
			asAlice,
			`?since=${aliceFirst.cursor}`,
			(p) => p.tombstones.length >= 1,
		);
		// Bob, holding Alice's cursor, sees nothing of her delete.
		const bobWithAlices = await pull(
			"expenses",
			asBob,
			`?since=${aliceFirst.cursor}`,
		);
		expect(bobWithAlices.tombstones).toEqual([]);
		expect(bobWithAlices.items.map((r) => r.id)).not.toContain(mine.expense);
		for (const which of ["categories", "templates"] as const) {
			const page = await pull(which, asBob);
			expect(ids(page)).not.toContain(
				which === "categories" ? mine.category : mine.template,
			);
		}
	});
});
