import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { createRetrospendClient } from "./index";

function fakeFetch(status: number, body: unknown) {
	const calls: Request[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push(new Request(input, init));
		return new Response(JSON.stringify(body), {
			status,
			headers: {
				"content-type":
					status >= 400 ? "application/problem+json" : "application/json",
			},
		});
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe("createRetrospendClient", () => {
	it("calls the contract route with the credentials", async () => {
		const { calls, fetch } = fakeFetch(200, { name: "Retrospend" });
		const client = createRetrospendClient({
			baseUrl: "https://example.test/",
			authHeaders: () => ({ "x-api-key": "rsk_test" }),
			fetch,
		});
		await client.platform.serverInfo().catch(() => undefined);

		expect(calls[0]?.url).toBe("https://example.test/api/v1/server-info");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers.get("x-api-key")).toBe("rsk_test");
	});

	it("turns problem+json into an ORPCError with the stable code", async () => {
		const problem = {
			type: "urn:retrospend:problem:missing_scope",
			title: "Missing scope",
			status: 403,
			code: "missing_scope",
			requiredScope: "read",
		};
		const { fetch } = fakeFetch(403, problem);
		const client = createRetrospendClient({
			baseUrl: "https://example.test",
			fetch,
		});

		const error = await client.platform.me().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ORPCError);
		expect(error).toMatchObject({
			code: "missing_scope",
			status: 403,
			data: problem,
		});
	});
});
