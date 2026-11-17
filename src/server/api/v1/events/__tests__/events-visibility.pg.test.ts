/**
 * Who sees which events on GET /api/v1/events: `vault.changed` only for a
 * caller holding the `vault` scope, and for an account with advanced
 * protection only the types and copies that carry no personal ids or amounts.
 * Rows are written straight into the outbox so each case controls the exact
 * stretch of events the feed has to page over.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openTransactionsEnded } from "~/test/pg-harness";
import {
	adminDb,
	asKey,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	sessionFor,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Feed = {
	items: { type: string; actorUserId: string | null }[];
	cursor: string | null;
	hasMore: boolean;
};

const bare = { ids: {}, amounts: [], truncated: false };
const withMoney = {
	ids: { categoryId: "cat1" },
	amounts: [{ name: "amount", minor: 12_345, currency: "ARS" }],
	truncated: false,
};

let ipCounter = 0;
/** A request address of its own, so the per-IP limit is never shared. */
const ipFor = () => ({
	"x-forwarded-for": `203.0.113.${(ipCounter++ % 250) + 1}`,
});

async function newUser() {
	return (await createTestUser()).user.id;
}

async function append(
	userId: string,
	rows: {
		type: string;
		payload?: object;
		actorUserId?: string | null;
		sourceEventId?: string;
	}[],
) {
	await adminDb.apiEvent.createMany({
		data: rows.map((r) => ({
			userId,
			type: r.type,
			actorUserId: r.actorUserId === undefined ? userId : r.actorUserId,
			payload: r.payload ?? bare,
			sourceEventId: r.sourceEventId,
		})),
	});
}

/** One feed read; rows show once every older open transaction has ended. */
async function readFeed(headers: Record<string, string>, query = "") {
	await openTransactionsEnded();
	return expectBody<Feed>(
		await call(`/events${query}`, { headers: { ...ipFor(), ...headers } }),
		contract.events.list,
	);
}

const typesOf = (page: Feed) => page.items.map((i) => i.type);

describe("vault.changed in the feed", () => {
	let userId: string;
	beforeAll(async () => {
		userId = await newUser();
		await append(
			userId,
			Array.from({ length: 150 }, () => ({ type: "vault.changed" })),
		);
		await append(userId, [{ type: "expense.created", payload: withMoney }]);
	});

	it("is skipped in the query, so a page of 100 reaches the event behind 150 of them", async () => {
		const headers = await asKey(userId, ["read"]);
		const page = await readFeed(headers, "?limit=100");
		expect(typesOf(page)).toEqual(["expense.created"]);
		expect(page.hasMore).toBe(false);
		expect(page.cursor).not.toBeNull();
	});

	it("is never shown to a read token, a narrowed mobile session or a device session", async () => {
		const callers = {
			mobileRead: {
				authorization: `Bearer ${await sessionFor(userId, { scopes: "read", clientId: "retrospend-mobile" })}`,
			},
			device: {
				authorization: `Bearer ${await sessionFor(userId, { scopes: "read write:expenses write:money", clientId: "some-device" })}`,
			},
			key: await asKey(userId, ["read", "write:expenses", "write:money"]),
		};
		for (const [name, headers] of Object.entries(callers)) {
			const page = await readFeed(headers, "?limit=100");
			expect(typesOf(page), name).toEqual(["expense.created"]);
		}
	});

	it("is shown to a web session, and to a mobile session that holds vault", async () => {
		const web = await readFeed(await webCookieFor(userId), "?limit=100");
		expect(typesOf(web)).toEqual(Array(100).fill("vault.changed"));
		expect(web.hasMore).toBe(true);
		const mobile = await readFeed(
			{
				authorization: `Bearer ${await sessionFor(userId)}`,
			},
			"?limit=200",
		);
		expect(typesOf(mobile).filter((t) => t === "vault.changed")).toHaveLength(
			150,
		);
	});

	it("moves the cursor over a stretch of only vault events", async () => {
		const only = await newUser();
		await append(
			only,
			Array.from({ length: 5 }, () => ({ type: "vault.changed" })),
		);
		const headers = await asKey(only, ["read"]);
		const empty = await readFeed(headers);
		expect(empty.items).toEqual([]);
		expect(empty.hasMore).toBe(false);
		await append(only, [{ type: "expense.created" }]);
		const next = await readFeed(headers);
		expect(typesOf(next)).toEqual(["expense.created"]);
		const after = await readFeed(headers, `?after=${next.cursor}`);
		expect(after.items).toEqual([]);
		expect(after.cursor).toBe(next.cursor);
	});
});

describe("a protected account's feed", () => {
	let userId: string;
	let other: string;
	beforeAll(async () => {
		userId = await newUser();
		other = await newUser();
		await adminDb.user.update({
			where: { id: userId },
			data: { protectionState: "ON" },
		});
		await append(userId, [
			// Written while protection was off, with amounts and a category id.
			{ type: "expense.created", payload: withMoney },
			{ type: "shared_expense.created", payload: withMoney },
			{ type: "settings.updated" },
			{ type: "token.created" },
			{ type: "vault.changed" },
			{ type: "user.session_ended" },
			// Another person's change to a thing shared with this account: a bare copy.
			{
				type: "shared_expense.updated",
				actorUserId: other,
				sourceEventId: "src-bare",
			},
			// A row marked as a copy that carries data must stay out.
			{
				type: "payment.recorded",
				actorUserId: other,
				sourceEventId: "src-data",
				payload: withMoney,
			},
			// A copy that names the account itself as actor is not one the app writes.
			{
				type: "payment.confirmed",
				actorUserId: userId,
				sourceEventId: "src-self",
			},
		]);
	});

	it("reads /events without the personal events, with the safe types and the bare copy", async () => {
		const page = await readFeed(await webCookieFor(userId), "?limit=100");
		expect(typesOf(page)).toEqual([
			"token.created",
			"vault.changed",
			"user.session_ended",
			"shared_expense.updated",
		]);
		expect(page.items.at(-1)?.actorUserId).toBe(other);
	});

	it("gives its own API key the same filter, and no vault event", async () => {
		const page = await readFeed(await asKey(userId, ["read"]), "?limit=100");
		expect(typesOf(page)).toEqual([
			"token.created",
			"user.session_ended",
			"shared_expense.updated",
		]);
	});

	it("still refuses a personal route", async () => {
		await expectProblem(
			await call("/expenses", {
				headers: { ...ipFor(), ...(await webCookieFor(userId)) },
			}),
			403,
			"protected_account",
		);
	});

	it("shows the same events to the account with protection off, all of them", async () => {
		const plain = await newUser();
		await append(plain, [
			{ type: "expense.created", payload: withMoney },
			{ type: "token.created" },
		]);
		const page = await readFeed(await asKey(plain, ["read"]));
		expect(typesOf(page)).toEqual(["expense.created", "token.created"]);
	});
});
