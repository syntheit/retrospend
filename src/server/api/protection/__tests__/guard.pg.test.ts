/**
 * Advanced protection end to end on real Postgres: sessions and keys are real,
 * the protection state is set on the owner connection, and the calls go through
 * the real tRPC context and the real v1 handler. A protected account is
 * refused where the allowlist says so, answered where it does not, and a
 * refusal writes nothing: no idempotency record, no event, no keyring, no
 * time zone claim.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Client } from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import {
	apiKeyFor,
	call,
	createTestUser,
	webCookieFor,
} from "~/server/api/v1/core/__tests__/harness";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";
import { adminDb } from "~/test/pg-harness";
import { problemCode } from "~/server/api/error-formatter";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// The real function, watched: a refusal must come before it.
vi.mock("~/server/services/keys/data-key.service", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("~/server/services/keys/data-key.service")
		>();
	return {
		...real,
		ensureUserKeyringWhenSealing: vi.fn(real.ensureUserKeyringWhenSealing),
	};
});

const keyringCalls = vi.mocked(ensureUserKeyringWhenSealing);

let owner: Client;
beforeAll(async () => {
	owner = new Client({ connectionString: process.env.DATABASE_URL });
	await owner.connect();
});
afterAll(async () => {
	await owner.end();
});
beforeEach(() => keyringCalls.mockClear());

/** A user with a cookie session and no stored time zone, ON or OFF. */
async function account(state: "ON" | "OFF") {
	const made = await createTestUser();
	await owner.query(
		`UPDATE "user" SET "protectionState" = $2::"ProtectionState", "timeZone" = NULL WHERE "id" = $1`,
		[made.user.id, state],
	);
	const { cookie } = await webCookieFor(made.user.id);
	return { id: made.user.id, cookie };
}

const zoneOf = async (id: string) =>
	(await adminDb.user.findUniqueOrThrow({ where: { id } })).timeZone;

/** The tRPC caller a browser request builds: the real context from the cookie. */
async function trpcFor(cookie: string, zone?: string) {
	const headers = new Headers({ cookie });
	if (zone) headers.set("x-timezone", zone);
	return createCaller(await createTRPCContext({ headers }));
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
	try {
		await run();
		return null;
	} catch (error) {
		return error instanceof TRPCError ? (problemCode(error) ?? null) : null;
	}
}

const listInput = { limit: 5 } as never;

async function rowsOf(userId: string) {
	const [idempotency, events] = await Promise.all([
		adminDb.idempotencyKey.count({ where: { userId } }),
		adminDb.apiEvent.count({ where: { userId } }),
	]);
	return { idempotency, events };
}

describe("tRPC", () => {
	it("refuses a protected account the ledger and answers its profile", async () => {
		const on = await account("ON");
		const trpc = await trpcFor(on.cookie, "Europe/Madrid");
		expect(await refusal(() => trpc.expense.listV2(listInput))).toBe(
			"protected_account",
		);
		expect(await refusal(() => trpc.expense.listSharedParticipations())).toBe(
			"protected_account",
		);
		const avatar = await trpc.profile.getMyAvatar();
		expect(avatar.name).toContain("Test");
	});

	it("answers an account with protection off", async () => {
		const off = await account("OFF");
		const trpc = await trpcFor(off.cookie);
		expect(await refusal(() => trpc.expense.listSharedParticipations())).toBe(
			null,
		);
		expect((await trpc.profile.getMyAvatar()).name).toContain("Test");
	});

	it("writes nothing on a refusal: no keyring call, no time zone claim", async () => {
		const on = await account("ON");
		const trpc = await trpcFor(on.cookie, "Europe/Madrid");
		keyringCalls.mockClear();
		await refusal(() => trpc.expense.listV2(listInput));
		expect(keyringCalls).not.toHaveBeenCalled();
		expect(await zoneOf(on.id)).toBeNull();

		// The same request as an allowed one does both, so the check can fail.
		await trpc.profile.getMyAvatar();
		expect(keyringCalls).toHaveBeenCalledWith(on.id);
	});
});

describe("API v1", () => {
	it("refuses a protected account GET /expenses and answers GET /me", async () => {
		const on = await account("ON");
		const refused = await call("/expenses", { headers: { cookie: on.cookie } });
		expect(refused.status).toBe(403);
		expect(refused.headers.get("content-type")).toBe(
			"application/problem+json",
		);
		expect(await refused.json()).toMatchObject({
			status: 403,
			code: "protected_account",
			title: "Advanced protection is on",
		});
		const me = await call("/me", { headers: { cookie: on.cookie } });
		expect(me.status).toBe(200);
		expect(await me.json()).toMatchObject({ id: on.id });
	});

	it("answers an account with protection off on both", async () => {
		const off = await account("OFF");
		expect(
			(await call("/expenses", { headers: { cookie: off.cookie } })).status,
		).toBe(200);
		expect(
			(await call("/me", { headers: { cookie: off.cookie } })).status,
		).toBe(200);
	});

	it("refuses an API key of a protected account the same way", async () => {
		const on = await account("ON");
		const key = await apiKeyFor(on.id, ["read", "write:expenses"]);
		const refused = await call("/expenses", { headers: { "x-api-key": key } });
		expect(refused.status).toBe(403);
		expect(await refused.json()).toMatchObject({ code: "protected_account" });
		expect((await call("/me", { headers: { "x-api-key": key } })).status).toBe(
			200,
		);
	});

	it("keeps a missing scope a missing_scope, not a protection refusal", async () => {
		const on = await account("ON");
		const key = await apiKeyFor(on.id, ["write:settings"]);
		const res = await call("/expenses", { headers: { "x-api-key": key } });
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "missing_scope" });
	});

	it("writes nothing on a refusal: no idempotency record, event or keyring call, and the zone stays", async () => {
		const on = await account("ON");
		const headers = {
			cookie: on.cookie,
			"x-timezone": "Europe/Madrid",
		};
		keyringCalls.mockClear();
		const refused = await call("/expenses", {
			method: "POST",
			headers,
			body: { description: "refused" },
			idempotent: randomBytes(8).toString("hex"),
		});
		expect(refused.status).toBe(403);
		expect(await refused.json()).toMatchObject({ code: "protected_account" });
		expect(keyringCalls).not.toHaveBeenCalled();
		expect(await rowsOf(on.id)).toEqual({ idempotency: 0, events: 0 });
		expect(await zoneOf(on.id)).toBeNull();

		// An allowed write from the same account leaves all of it, so the
		// counts above are ones that can move.
		const allowed = await call("/me/consent", {
			method: "POST",
			headers,
			body: { consentVersion: randomUUID().slice(0, 8) },
			idempotent: true,
		});
		expect(allowed.status).toBe(200);
		expect((await rowsOf(on.id)).idempotency).toBe(1);
		expect(keyringCalls).toHaveBeenCalledWith(on.id);
	});
});
