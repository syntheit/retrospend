import { dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "~/trpc/query-client";

/** Stand-in for Prisma's Decimal: a class instance with toJSON. */
class FakeDecimal {
	constructor(private readonly value: string) {}
	toJSON() {
		return this.value;
	}
}

describe("server to browser query hand-off", () => {
	it("sends only settled queries, never one still in flight", async () => {
		const server = createQueryClient();
		await server.prefetchQuery({ queryKey: ["settled"], queryFn: () => 1 });
		void server.prefetchQuery({
			queryKey: ["in-flight"],
			queryFn: () => new Promise(() => {}),
		});

		const keys = dehydrate(server).queries.map((q) => q.queryKey);
		expect(keys).toEqual([["settled"]]);
	});

	it("sends data in the shape the HTTP link delivers", async () => {
		const server = createQueryClient();
		const when = new Date("2026-10-21T12:00:00Z");
		await server.prefetchQuery({
			queryKey: ["asset"],
			queryFn: () => ({ rate: new FakeDecimal("1500.25"), when }),
		});
		const state = dehydrate(server);
		// Plain JSON only: React cannot pass class instances to the browser
		expect(JSON.parse(JSON.stringify(state.queries[0]?.state.data))).toEqual(
			state.queries[0]?.state.data,
		);

		const browser = createQueryClient();
		hydrate(browser, state);
		expect(browser.getQueryData(["asset"])).toEqual({ rate: "1500.25", when });
	});

	it("fills a query that already exists but is empty, right away", async () => {
		// The command palette creates the transactions query before the page's
		// data arrives; hydrate() must fill it synchronously (HydrateQueries)
		const server = createQueryClient();
		await server.prefetchQuery({ queryKey: ["list"], queryFn: () => [1, 2] });
		const state = dehydrate(server);

		const browser = createQueryClient();
		browser.getQueryCache().build(browser, { queryKey: ["list"] });
		expect(browser.getQueryData(["list"])).toBeUndefined();

		hydrate(browser, state);
		expect(browser.getQueryData(["list"])).toEqual([1, 2]);
	});
});
