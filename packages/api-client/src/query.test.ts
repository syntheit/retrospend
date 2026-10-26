import { QueryClient } from "@tanstack/query-core";
import {
	contract,
	EVENT_TYPES,
	listContractRoutes,
} from "@retrospend/api-contract";
import { describe, expect, it, vi } from "vitest";
import { startEventFeed } from "./event-feed";
import { createRetrospendClient } from "./index";
import { EVERYTHING, invalidationFor, RESOURCE_GROUPS } from "./invalidation";
import {
	createApiQueryUtils,
	eventTypeOfRoute,
	installMutationInvalidation,
	invalidateForEvent,
	QUERY_KEY_ROOT,
} from "./query";

function client(fetch: typeof globalThis.fetch) {
	return createRetrospendClient({ baseUrl: "https://example.test", fetch });
}

function seed(queryClient: QueryClient, group: string, route: string) {
	queryClient.setQueryData([[QUERY_KEY_ROOT, group, route], { type: "query" }], 1);
}

const stale = (queryClient: QueryClient, group: string, route: string) =>
	queryClient.getQueryState([[QUERY_KEY_ROOT, group, route], { type: "query" }])
		?.isInvalidated;

describe("event types and invalidation", () => {
	it("knows every registered event type's resource", () => {
		const unknown = EVENT_TYPES.filter(
			(type) => invalidationFor(type) === EVERYTHING && !type.startsWith("user."),
		);
		expect(unknown, "event types with no invalidation entry").toEqual([]);
	});

	it("lists only groups that exist in the contract", () => {
		const groups = new Set(Object.keys(contract));
		for (const [resource, list] of Object.entries(RESOURCE_GROUPS))
			for (const group of list)
				expect(groups.has(group), `${resource} -> ${group}`).toBe(true);
	});

	it("lets a resource refresh its own group", () => {
		const own: Record<string, string> = {
			expense: "expenses",
			income: "income",
			transfer: "transfers",
			recurring: "recurring",
			webhook: "webhooks",
			token: "tokens",
			category: "categories",
			payment: "payments",
			project: "projects",
			person: "people",
			account: "accounts",
			notification: "notifications",
			shared_expense: "shared-expenses",
			billing_period: "billing-periods",
		};
		for (const [resource, group] of Object.entries(own))
			expect(invalidationFor(`${resource}.changed`)).toContain(group);
		expect(invalidationFor("budget_envelope.moved")).toContain("budget");
	});

	it("refreshes everything for an account deletion and for a type it does not know", () => {
		expect(invalidationFor("user.deleted")).toBe(EVERYTHING);
		expect(invalidationFor("hologram.projected")).toBe(EVERYTHING);
	});

	it("marks a ledger write's dependents stale and leaves other keys alone", async () => {
		const queryClient = new QueryClient();
		seed(queryClient, "expenses", "list");
		seed(queryClient, "figures", "read");
		seed(queryClient, "tokens", "list");
		queryClient.setQueryData([["expenses", "list"], { type: "query" }], 1);
		await invalidateForEvent(queryClient, "expense.created");
		expect(stale(queryClient, "expenses", "list")).toBe(true);
		expect(stale(queryClient, "figures", "read")).toBe(true);
		expect(stale(queryClient, "tokens", "list")).toBe(false);
		// Another library's key with the same shape is not ours.
		expect(
			queryClient.getQueryState([["expenses", "list"], { type: "query" }])
				?.isInvalidated,
		).toBe(false);
	});
});

describe("query utils", () => {
	it("reaches every route in the contract with a query or mutation key", () => {
		const utils = createApiQueryUtils(
			client((async () => new Response("{}")) as typeof globalThis.fetch),
		);
		for (const route of listContractRoutes(contract)) {
			let node: unknown = utils;
			for (const key of route.key)
				node = (node as Record<string, unknown>)[key];
			const procedure = node as {
				queryKey: () => unknown;
				mutationKey: () => unknown;
			};
			expect(procedure, route.key.join(".")).toBeDefined();
			const key = (
				route.method === "GET" ? procedure.queryKey() : procedure.mutationKey()
			) as [string[]];
			expect(key[0]).toEqual([QUERY_KEY_ROOT, ...route.key]);
		}
	});

	it("takes a route's event type from the contract", () => {
		expect(eventTypeOfRoute(["tokens", "create"])).toBe("token.created");
		expect(eventTypeOfRoute(["tokens", "list"])).toBeUndefined();
		expect(eventTypeOfRoute(["nope", "nothing"])).toBeUndefined();
	});

	it("fetches through queryOptions", async () => {
		const calls: string[] = [];
		const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(new Request(input, init).url);
			return new Response(JSON.stringify({ items: [], nextCursor: null }), {
				headers: { "content-type": "application/json" },
			});
		}) as typeof globalThis.fetch;
		const utils = createApiQueryUtils(client(fetch));
		const queryClient = new QueryClient();
		const data = await queryClient.fetchQuery(
			utils.tokens.list.queryOptions({ input: {} }),
		);
		expect(data).toBeDefined();
		expect(calls[0]).toContain("/api/v1/tokens");
	});
});

describe("mutation invalidation", () => {
	it("invalidates by the route's event after a successful mutation", async () => {
		const queryClient = new QueryClient();
		const fetch = (async () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof globalThis.fetch;
		const utils = createApiQueryUtils(client(fetch));
		const stop = installMutationInvalidation(queryClient);
		seed(queryClient, "tokens", "list");
		seed(queryClient, "webhooks", "list");
		await queryClient
			.getMutationCache()
			.build(queryClient, utils.tokens.revoke.mutationOptions())
			.execute({ id: "t1" });
		expect(stale(queryClient, "tokens", "list")).toBe(true);
		expect(stale(queryClient, "webhooks", "list")).toBe(false);
		stop();
	});

	it("sends an Idempotency-Key on a write that was given none, and none on a read", async () => {
		const seen: Array<string | null> = [];
		const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			seen.push(new Request(input, init).headers.get("idempotency-key"));
			return new Response("{}", {
				headers: { "content-type": "application/json" },
			});
		}) as typeof globalThis.fetch;
		const api = client(fetch);
		await api.tokens.revoke({ id: "t1" }).catch(() => undefined);
		await api.tokens.revoke({ id: "t1" }).catch(() => undefined);
		await api.tokens.list({}).catch(() => undefined);
		expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(seen[1]).not.toBe(seen[0]);
		expect(seen[2]).toBeNull();
	});
});

describe("event feed", () => {
	it("skips history on a first run, then invalidates what is new", async () => {
		vi.useFakeTimers();
		try {
			const pages = [
				{
					items: [{ type: "token.created" }],
					cursor: "c1",
					hasMore: false,
				},
				{
					items: [{ type: "webhook.created" }],
					cursor: "c2",
					hasMore: false,
				},
			];
			const afters: Array<string | null> = [];
			const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(new Request(input, init).url);
				afters.push(url.searchParams.get("after"));
				return Response.json(pages.shift() ?? { items: [], cursor: "c2", hasMore: false });
			}) as typeof globalThis.fetch;
			const queryClient = new QueryClient();
			seed(queryClient, "webhooks", "list");
			seed(queryClient, "tokens", "list");
			const cursors: string[] = [];
			const stop = startEventFeed(client(fetch), queryClient, {
				intervalMs: 1000,
				onCursor: (c) => cursors.push(c),
			});
			await vi.advanceTimersByTimeAsync(10);
			expect(stale(queryClient, "tokens", "list")).toBe(false);
			await vi.advanceTimersByTimeAsync(1000);
			stop();
			expect(afters).toEqual([null, "c1"]);
			expect(cursors).toEqual(["c1", "c2"]);
			expect(stale(queryClient, "webhooks", "list")).toBe(true);
			expect(stale(queryClient, "tokens", "list")).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
