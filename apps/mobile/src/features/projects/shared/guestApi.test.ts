import { createGuestApi, GuestApiError } from "./guestApi";

function reply(status: number, body: unknown) {
	return jest.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
}

describe("createGuestApi", () => {
	it("reads a query with the input in the address and the viewer link in a header", async () => {
		const fetchImpl = reply(200, {
			result: { data: { json: { projectName: "Trip" } } },
		});
		const api = createGuestApi(
			"https://retrospend.app/",
			{ viewerLink: "v1" },
			fetchImpl as never,
		);
		const out = await api.validateLink("abc");
		expect(out).toEqual({ projectName: "Trip" });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string> },
		];
		expect(url).toBe(
			`https://retrospend.app/api/trpc/guest.validateLink?input=${encodeURIComponent(
				JSON.stringify({ json: { linkId: "abc" } }),
			)}`,
		);
		expect(init.headers["x-viewer-link-id"]).toBe("v1");
		expect(init.headers["x-guest-token"]).toBeUndefined();
	});

	it("posts a mutation with the guest token", async () => {
		const fetchImpl = reply(200, { result: { data: { json: { ok: true } } } });
		const api = createGuestApi(
			"https://retrospend.app",
			{ token: "secret" },
			fetchImpl as never,
		);
		await api.claim({ linkId: "l", guestSessionId: "g", shadowId: "s" });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string; headers: Record<string, string> },
		];
		expect(url).toBe("https://retrospend.app/api/trpc/claim.linkGuestToGhost");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({
			json: { linkId: "l", guestSessionId: "g", shadowId: "s" },
		});
		expect(init.headers["x-guest-token"]).toBe("secret");
	});

	it("names the failure by the server's code", async () => {
		const fetchImpl = reply(404, {
			error: { json: { data: { code: "NOT_FOUND" } } },
		});
		const api = createGuestApi("https://x.org", {}, fetchImpl as never);
		await expect(api.validateLink("gone")).rejects.toMatchObject({
			code: "NOT_FOUND",
			status: 404,
		});
		await expect(api.validateLink("gone")).rejects.toBeInstanceOf(
			GuestApiError,
		);
	});

	it("treats an unreadable answer as an unknown failure", async () => {
		const fetchImpl = jest.fn(
			async () => new Response("<html>", { status: 502 }),
		);
		const api = createGuestApi("https://x.org", {}, fetchImpl as never);
		await expect(api.publicPage("p")).rejects.toMatchObject({
			code: "UNKNOWN",
		});
	});

	it("passes a null public page through", async () => {
		const fetchImpl = reply(200, { result: { data: { json: null } } });
		const api = createGuestApi("https://x.org", {}, fetchImpl as never);
		await expect(api.publicPage("p")).resolves.toBeNull();
	});
});
