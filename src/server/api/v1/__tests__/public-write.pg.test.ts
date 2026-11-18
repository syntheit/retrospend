/**
 * Public writes (V1-0) on Postgres, through the same fetch handler the Next
 * route uses: any public POST runs as no user, whatever session came with it,
 * so no idempotency row, event, keyring or zone is made as that user; a
 * publicWrite route needs no Idempotency-Key while a signed-in write still
 * does; a public GET still reflects the caller; and a publicWrite meta the
 * conventions would refuse is never run.
 */
import { implement } from "@orpc/server";
import { type ApiMeta, v1 as route } from "@retrospend/api-contract/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import {
	adminDb,
	asMobile,
	createTestUser,
	expectProblem,
	webCookieFor,
} from "../core/__tests__/harness";
import { createV1Handler } from "../handler";
import {
	type V1Context,
	type V1InitialContext,
	v1Middleware,
} from "../middleware";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// Real implementations, watched: a public write must not call them.
const spies = vi.hoisted(() => ({ keyring: vi.fn(), zone: vi.fn() }));
vi.mock("~/server/services/keys/data-key.service", async (original) => {
	const actual =
		await original<typeof import("~/server/services/keys/data-key.service")>();
	spies.keyring.mockImplementation(actual.ensureUserKeyringWhenSealing);
	return { ...actual, ensureUserKeyringWhenSealing: spies.keyring };
});
vi.mock("~/server/services/user-time-zone", async (original) => {
	const actual =
		await original<typeof import("~/server/services/user-time-zone")>();
	spies.zone.mockImplementation(actual.userTimeZone);
	return { ...actual, userTimeZone: spies.zone };
});

// What each handler saw as the caller, and whether it ran at all.
const seen = vi.hoisted(() => ({ ran: [] as string[] }));
const out = z.object({ user: z.string().nullable() });
const probe = (
	method: "GET" | "POST" | "PUT",
	path: string,
	meta: ApiMeta,
) =>
	route
		.route({ method, path: `/probe${path}`, operationId: `probe${path}` })
		.meta(meta)
		.output(out);

const testContract = {
	resetToken: probe("POST", "/reset-token", {
		scope: "public",
		publicWrite: "resetToken",
	}),
	resetRequest: probe("POST", "/reset-request", {
		scope: "public",
		publicWrite: "resetRequest",
	}),
	// Not allowed by the conventions (a public write with no meta); the server
	// must still never run it as the cookie's user.
	bare: probe("POST", "/bare", { scope: "public" }),
	bareWithEvent: probe("POST", "/bare-event", {
		scope: "public",
		event: "category.created",
	}),
	barePut: probe("PUT", "/bare-put", { scope: "public" }),
	publicGet: probe("GET", "/public-get", { scope: "public" }),
	signedWrite: probe("POST", "/signed-write", {
		scope: "write:expenses",
		event: "category.created",
	}),
	// publicWrite metas the conventions refuse: the server answers 500.
	unknownValue: probe("POST", "/unknown-value", {
		scope: "public",
		publicWrite: "resetTokn" as never,
	}),
	onGet: probe("GET", "/pw-get", {
		scope: "public",
		publicWrite: "resetToken",
	}),
	signedScope: probe("POST", "/pw-signed", {
		scope: "write:expenses",
		publicWrite: "resetToken",
	}),
	withEvent: probe("POST", "/pw-event", {
		scope: "public",
		publicWrite: "resetToken",
		event: "category.created",
	}),
	alsoReadsOnly: probe("POST", "/pw-reads", {
		scope: "public",
		publicWrite: "resetToken",
		readsOnly: true,
	}),
};

const t = implement(testContract)
	.$context<V1InitialContext>()
	.use(v1Middleware);

const answer =
	(name: string) =>
	async ({ context }: { context: V1Context }) => {
		seen.ran.push(name);
		return { user: context.user?.principal.userId ?? null };
	};
const handle = createV1Handler(
	t.router({
		resetToken: t.resetToken.handler(answer("resetToken")),
		resetRequest: t.resetRequest.handler(answer("resetRequest")),
		bare: t.bare.handler(answer("bare")),
		bareWithEvent: t.bareWithEvent.handler(answer("bareWithEvent")),
		barePut: t.barePut.handler(answer("barePut")),
		publicGet: t.publicGet.handler(answer("publicGet")),
		signedWrite: t.signedWrite.handler(answer("signedWrite")),
		unknownValue: t.unknownValue.handler(answer("unknownValue")),
		onGet: t.onGet.handler(answer("onGet")),
		signedScope: t.signedScope.handler(answer("signedScope")),
		withEvent: t.withEvent.handler(answer("withEvent")),
		alsoReadsOnly: t.alsoReadsOnly.handler(answer("alsoReadsOnly")),
	}),
);

let n = 0;
const send = (
	path: string,
	init: { headers?: Record<string, string> } = {},
	method = "POST",
) =>
	handle(
		new Request(`http://localhost:3101/api/v1/probe${path}`, {
			method,
			headers: {
				"x-forwarded-for": `203.0.113.${10 + (n++ % 200)}`,
				"content-type": "application/json",
				...init.headers,
			},
			body: method === "GET" ? undefined : "{}",
		}),
	);

async function rowsOf(userId: string) {
	return {
		keys: await adminDb.idempotencyKey.count({ where: { userId } }),
		events: await adminDb.apiEvent.count({ where: { userId } }),
	};
}

beforeEach(() => {
	seen.ran.length = 0;
});

describe("a public write with another user's session", () => {
	// Each of these is a public write; the cookie's user must not be the caller.
	const writes = [
		["resetToken", "/reset-token", "POST"],
		["resetRequest", "/reset-request", "POST"],
		["bare", "/bare", "POST"],
		["bareWithEvent", "/bare-event", "POST"],
		["barePut", "/bare-put", "PUT"],
	] as const;

	for (const [name, path, method] of writes) {
		it(`${name} runs as no user: no idempotency row, no event, no keyring, no zone`, async () => {
			const victim = await createTestUser();
			const cookie = await webCookieFor(victim.user.id);
			const bearer = await asMobile(victim.user.id);
			spies.keyring.mockClear();
			spies.zone.mockClear();

			for (const headers of [
				{ ...cookie, "idempotency-key": `pw-${name}-${victim.user.id}` },
				bearer,
			]) {
				const res = await send(path, { headers }, method);
				expect(res.status, await res.clone().text()).toBe(200);
				expect(await res.json()).toEqual({ user: null });
			}
			expect(seen.ran).toEqual([name, name]);
			expect(spies.keyring).not.toHaveBeenCalled();
			expect(spies.zone).not.toHaveBeenCalled();
			expect(await rowsOf(victim.user.id)).toEqual({ keys: 0, events: 0 });
		});
	}

	it("still runs a signed-in write as the user, with a key, an event and a keyring (the control)", async () => {
		const user = await createTestUser();
		const headers = {
			...(await webCookieFor(user.user.id)),
			"idempotency-key": `control-${user.user.id}`,
		};
		spies.keyring.mockClear();
		const res = await send("/signed-write", { headers });
		expect(await res.json()).toEqual({ user: user.user.id });
		expect(spies.keyring).toHaveBeenCalledWith(user.user.id);
		expect(await rowsOf(user.user.id)).toEqual({ keys: 1, events: 1 });
	});
});

describe("a cross-site public write", () => {
	const crossSite = { "sec-fetch-site": "cross-site" };

	it("is refused when it carries a web cookie, and runs as no user without one", async () => {
		const victim = await createTestUser();
		const cookie = await webCookieFor(victim.user.id);
		await expectProblem(
			await send("/reset-token", { headers: { ...cookie, ...crossSite } }),
			403,
			"forbidden",
		);
		expect(seen.ran).toEqual([]);

		const res = await send("/reset-token", { headers: crossSite });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ user: null });
		expect(seen.ran).toEqual(["resetToken"]);
	});
});

describe("the Idempotency-Key", () => {
	it("is not needed by a publicWrite route, with or without a session", async () => {
		const user = await createTestUser();
		for (const path of ["/reset-token", "/reset-request"]) {
			expect((await send(path)).status).toBe(200);
			expect(
				(await send(path, { headers: await asMobile(user.user.id) })).status,
			).toBe(200);
		}
	});

	it("is still required by a signed-in write", async () => {
		const user = await createTestUser();
		await expectProblem(
			await send("/signed-write", {
				headers: await asMobile(user.user.id),
			}),
			400,
			"idempotency_key_required",
		);
		expect(seen.ran).toEqual([]);
	});
});

describe("a public GET", () => {
	it("still reflects the caller, as server-info does", async () => {
		const user = await createTestUser();
		const res = await send(
			"/public-get",
			{ headers: await asMobile(user.user.id) },
			"GET",
		);
		expect(await res.json()).toEqual({ user: user.user.id });
		const anon = await send("/public-get", {}, "GET");
		expect(await anon.json()).toEqual({ user: null });
	});
});

describe("a publicWrite meta the conventions refuse", () => {
	const refused = [
		["an unknown value", "/unknown-value", "POST"],
		["a GET", "/pw-get", "GET"],
		["a signed-in scope", "/pw-signed", "POST"],
		["an event", "/pw-event", "POST"],
		["readsOnly with it", "/pw-reads", "POST"],
	] as const;

	for (const [why, path, method] of refused) {
		it(`is never run: ${why}`, async () => {
			const user = await createTestUser();
			await expectProblem(
				await send(path, { headers: await asMobile(user.user.id) }, method),
				500,
				"internal",
			);
			expect(seen.ran).toEqual([]);
		});
	}
});
