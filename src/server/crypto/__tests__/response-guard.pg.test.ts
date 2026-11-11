/**
 * No sealed value leaves the server in tests (E2EE D11, design section 7.1,
 * plan test 11). The v1 handler and every tRPC procedure builder check their
 * responses: a raw sealed value fails the call, the fallback "" does not, and
 * a real route over a sealed row answers with the plaintext.
 */
import { os } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createCallerFactory,
	createTRPCContext,
	createTRPCRouter,
	publicProcedure,
} from "~/server/api/trpc";
import { asMobile, BASE, call } from "~/server/api/v1/core/__tests__/harness";
import { createV1Handler } from "~/server/api/v1/handler";
import type { Keyring } from "~/server/crypto/field-crypto";
import { evictDataKeyring } from "~/server/services/keys/data-key.service";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { newMasterKeyring, sealRow } from "~/test/sealed-fixture";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

beforeAll(() => {
	master.ring = newMasterKeyring();
	evictInstanceKeyring();
});
afterAll(() => evictInstanceKeyring());

const SEALED = "\u0001k1:AAAAAQ==";

describe("the tRPC guard", () => {
	const router = createTRPCRouter({
		leak: publicProcedure.query(() => ({ rows: [{ name: SEALED }] })),
		fallback: publicProcedure.query(() => ({ rows: [{ name: "" }] })),
	});
	const caller = async () =>
		createCallerFactory(router)(
			await createTRPCContext({ headers: new Headers() }),
		);

	it("fails a response that holds a sealed value, and passes the fallback", async () => {
		await expect((await caller()).leak()).rejects.toThrow(/sealed value/);
		expect(await (await caller()).fallback()).toEqual({ rows: [{ name: "" }] });
	});
});

describe("the v1 guard", () => {
	it("fails a JSON response that holds a sealed value", async () => {
		const handle = createV1Handler({
			leak: os
				.route({ method: "GET", path: "/leak" })
				.handler(() => ({ name: SEALED })),
			fallback: os
				.route({ method: "GET", path: "/fallback" })
				.handler(() => ({ name: "" })),
		});
		await expect(handle(new Request(`${BASE}/leak`))).rejects.toThrow(
			/sealed value/,
		);
		const ok = await handle(new Request(`${BASE}/fallback`));
		expect(await ok.json()).toEqual({ name: "" });
	});

	it("answers a real route over a sealed row with the plaintext", async () => {
		const { user } = await createTestUser();
		const category = await adminDb.category.create({
			data: { userId: user.id, name: "Comida", color: "blue" },
		});
		await sealRow(master.ring as Keyring, "category", category.id);
		const res = await call("/categories", { headers: await asMobile(user.id) });
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("Comida");
		expect(body).not.toContain("\\u0001");
	});

	it("answers 503 encrypted_text_unavailable when the reader's key is lost", async () => {
		const { user } = await createTestUser();
		const category = await adminDb.category.create({
			data: { userId: user.id, name: "Perdida", color: "blue" },
		});
		await sealRow(master.ring as Keyring, "category", category.id);
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${user.id}`;
		evictDataKeyring(user.id);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await call("/categories", { headers: await asMobile(user.id) });
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({
			code: "encrypted_text_unavailable",
		});
		vi.restoreAllMocks();
	});
});
