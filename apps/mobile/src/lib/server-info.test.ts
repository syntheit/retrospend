import {
	compareVersions,
	normalizeServerUrl,
	probeServer,
	type ServerInfo,
} from "./server-info";

const INFO: ServerInfo = {
	name: "Retrospend",
	version: "0.5.0",
	apiVersion: "v1",
	minClientVersion: "0.1.0",
	features: { apiV1: true, uiV2: false, envelopeBudget: false },
	auth: { methods: ["password", "totp", "bearer"], signUp: "inviteOnly" },
	push: { transports: ["unifiedpush"] },
};

function fakeFetch(respond: () => Promise<Response>) {
	const calls: string[] = [];
	const impl = ((url: string) => {
		calls.push(url);
		return respond();
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const json = (body: unknown, status = 200) =>
	Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	);

describe("normalizeServerUrl", () => {
	it.each([
		["retrospend.app", "https://retrospend.app"],
		["  retrospend.app/  ", "https://retrospend.app"],
		["https://retrospend.app/", "https://retrospend.app"],
		["http://192.168.1.20:2997", "http://192.168.1.20:2997"],
		["https://home.example/retrospend//", "https://home.example/retrospend"],
		["https://retrospend.app/?x=1#y", "https://retrospend.app"],
		["HTTPS://Retrospend.App", "https://retrospend.app"],
	])("%s -> %s", (input, expected) => {
		expect(normalizeServerUrl(input)).toBe(expected);
	});

	it.each(["", "   ", "ftp://retrospend.app", "https://", "not a host"])(
		"rejects %j",
		(input) => {
			expect(normalizeServerUrl(input)).toBeNull();
		},
	);
});

describe("compareVersions", () => {
	it.each([
		["0.10.0", "0.9.3", 1],
		["0.1.0", "0.1.0", 0],
		["0.1", "0.1.0", 0],
		["1.2.3-beta.1", "1.2.3", 0],
		["0.4.5", "1.0.0", -1],
	])("%s vs %s is %d", (a, b, expected) => {
		expect(compareVersions(a, b)).toBe(expected);
	});
});

describe("probeServer", () => {
	it("asks the v1 server-info route and returns the base URL", async () => {
		const { impl, calls } = fakeFetch(() => json(INFO));
		await expect(probeServer("retrospend.app", "0.1.0", impl)).resolves.toEqual(
			{ ok: true, baseUrl: "https://retrospend.app", info: INFO },
		);
		expect(calls).toEqual(["https://retrospend.app/api/v1/server-info"]);
	});

	it("does not fetch an invalid address", async () => {
		const { impl, calls } = fakeFetch(() => json(INFO));
		await expect(probeServer("ftp://x", "0.1.0", impl)).resolves.toEqual({
			ok: false,
			reason: "invalidUrl",
		});
		expect(calls).toEqual([]);
	});

	it("reports a network failure as unreachable", async () => {
		const { impl } = fakeFetch(() => Promise.reject(new TypeError("offline")));
		await expect(probeServer("retrospend.app", "0.1.0", impl)).resolves.toEqual(
			{ ok: false, reason: "unreachable" },
		);
	});

	it.each([
		["a 404", () => json({ error: "not found" }, 404)],
		["an HTML page", () => Promise.resolve(new Response("<html></html>"))],
		["another app's JSON", () => json({ name: "Immich", apiVersion: "v1" })],
	])("reports %s as not Retrospend", async (_label, respond) => {
		const { impl } = fakeFetch(respond);
		await expect(probeServer("retrospend.app", "0.1.0", impl)).resolves.toEqual(
			{ ok: false, reason: "notRetrospend" },
		);
	});

	it("refuses when the server needs a newer app", async () => {
		const { impl } = fakeFetch(() =>
			json({ ...INFO, minClientVersion: "0.2.0" }),
		);
		await expect(probeServer("retrospend.app", "0.1.9", impl)).resolves.toEqual(
			{ ok: false, reason: "appTooOld", minClientVersion: "0.2.0" },
		);
	});
});
