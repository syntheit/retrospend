/**
 * The tRPC route as the web calls it: an unexpected failure reaches the client
 * as a generic message and the server logs one line with no user text.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock:5432/mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "test-secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));
vi.mock("~/server/db", () => ({ db: {}, createUserScopedDb: vi.fn() }));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("~/server/api/root", async () => {
	const { createTRPCRouter, publicProcedure } = await import(
		"~/server/api/trpc"
	);
	return {
		appRouter: createTRPCRouter({
			crash: publicProcedure.mutation(() => {
				throw new Error('row failed for "Dinner with Ana"');
			}),
			refused: publicProcedure.mutation(() => {
				throw new TRPCError({ code: "NOT_FOUND", message: "Not here" });
			}),
		}),
	};
});

import { POST } from "../route";

const post = (path: string) =>
	POST(
		new Request(`http://localhost/api/trpc/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(null),
		}) as never,
	);

describe("the tRPC route", () => {
	it("logs an unexpected failure without its message and answers generically", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const res = await post("crash");
		const text = await res.text();
		expect(res.status).toBe(500);
		expect(text).toContain("Something went wrong");
		expect(text).not.toContain("Dinner");
		expect(log).toHaveBeenCalledOnce();
		const line = String(log.mock.calls[0]?.[0]);
		expect(line).toContain("[trpc] crash failed: Error");
		expect(line).not.toContain("Dinner");
		log.mockRestore();
	});

	it("logs nothing for a refusal the code threw on purpose", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect((await post("refused")).status).toBe(404);
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
