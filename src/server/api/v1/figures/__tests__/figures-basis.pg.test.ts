/**
 * GET /api/v1/figures on Postgres: the `basis` goes only to a principal that
 * holds the `sync` scope (the web app's cookie session and the phone app's
 * session). A read token of any kind gets the figures and nothing more, since
 * `asOf` follows the instance's transaction counter.
 */
import { contract, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
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

type Body = { figures: { id: string }[]; basis?: Record<string, unknown> };

/** Its own address, so the per-IP limit the other v1 files share is never used up. */
const OWN_IP = { "x-forwarded-for": "198.51.100.95" };

const read = async (headers: Record<string, string>) =>
	expectBody<Body>(
		await call("/figures?ids=spent", { headers: { ...OWN_IP, ...headers } }),
		contract.figures.read,
	);

describe("figures basis: who gets it", () => {
	let userId: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: userId },
			data: {
				homeCurrency: "ARS",
				fiscalMonthStartDay: 15,
				timeZone: "Asia/Tokyo",
			},
		});
	});

	it("answers the web app's cookie session with a basis", async () => {
		const body = await read(await webCookieFor(userId));
		expect(body.figures.map((f) => f.id)).toEqual(["spent"]);
		expect(body.basis).toMatchObject({
			home: "ARS",
			timeZone: "Asia/Tokyo",
			startDay: 15,
		});
		expect(typeof body.basis?.asOf).toBe("string");
	});

	it("answers the phone app's session with a basis", async () => {
		const body = await read(await asMobile(userId));
		expect(body.basis).toMatchObject({ home: "ARS", startDay: 15 });
	});

	it("leaves the basis out for an API key holding every token scope", async () => {
		const body = await read(await asKey(userId, [...SCOPES]));
		expect(body.figures.map((f) => f.id)).toEqual(["spent"]);
		expect(body).not.toHaveProperty("basis");
	});

	it("leaves the basis out for a device session (a personal token) holding every token scope", async () => {
		const token = await sessionFor(userId, {
			scopes: [...SCOPES].join(" "),
			clientId: "retrospend-cli",
		});
		const body = await read({ authorization: `Bearer ${token}` });
		expect(body.figures.map((f) => f.id)).toEqual(["spent"]);
		expect(body).not.toHaveProperty("basis");
	});

	it("refuses a phone session whose stored scopes lack read, so it never gets figures or a basis", async () => {
		const token = await sessionFor(userId, {
			scopes: "write:expenses",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await call("/figures?ids=spent", {
				headers: { ...OWN_IP, authorization: `Bearer ${token}` },
			}),
			403,
			"missing_scope",
		);
	});

	it("still refuses a protected account's web session", async () => {
		const protectedId = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: protectedId },
			data: { protectionState: "ON" },
		});
		await expectProblem(
			await call("/figures?ids=spent", {
				headers: { ...OWN_IP, ...(await webCookieFor(protectedId)) },
			}),
			403,
			"protected_account",
		);
	});
});
