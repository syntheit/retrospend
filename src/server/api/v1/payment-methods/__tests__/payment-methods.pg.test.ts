/**
 * /api/v1/payment-methods on Postgres: your list is replaced as a whole and
 * ranked by order, nobody else's rows can be touched, and the match shows
 * another person's methods only as far as their visibility lets you: PUBLIC
 * to anyone, the rest to people you share an expense with.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	ref,
	seedProject,
	seedShare,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract["payment-methods"];
type Method = { id: string; type: string; rank: number; identifier: string | null };
type Match = {
	compatible: { type: string; theirIdentifier: string | null; combinedScore: number }[];
	yourMethods: Method[];
	theirMethods: { type: string; identifier: string | null; id?: string }[];
};

describe("/api/v1/payment-methods", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asStranger: Record<string, string>;

	const put = (headers: Record<string, string>, methods: unknown[]) =>
		call("/payment-methods", {
			method: "PUT",
			headers,
			body: { methods },
			idempotent: true,
		});
	const bank = (identifier: string, visibility = "PAYMENT_ONLY") => ({
		type: "bank",
		label: "Galicia",
		identifier,
		visibility,
	});

	beforeAll(async () => {
		[sofia, martin, stranger] = [await arsUser(), await arsUser(), await arsUser()];
		[asSofia, asMartin, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(stranger.user.id),
		];
		// Both in one project, so each can read the other's split row (RLS).
		const trip = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		await seedShare(ref(sofia), ref(martin), "100", "ARS", { projectId: trip });
	});

	it("replaces the list, ranks it by order and drops what is left out", async () => {
		const first = await expectBody<{ items: Method[] }>(
			await put(asSofia, [
				bank("0070-1234", "PUBLIC"),
				{ type: "cash", visibility: "PAYMENT_ONLY", minAmount: "50", currency: "ARS" },
				{ type: "crypto", identifier: "bc1q", visibility: "FRIENDS_ONLY", currency: "BTC", network: "bitcoin" },
			]),
			c.replace,
		);
		expect(first.items.map((m) => [m.type, m.rank])).toEqual([
			["bank", 1],
			["cash", 2],
			["crypto", 3],
		]);
		expect(first.items[1]).toMatchObject({ minAmount: "50", currency: "ARS" });

		// Reordered: the crypto first, the bank kept by id, the cash dropped.
		const bankId = first.items[0]?.id;
		const cryptoId = first.items[2]?.id;
		const second = await expectBody<{ items: Method[] }>(
			await put(asSofia, [
				{ id: cryptoId, type: "crypto", identifier: "bc1q", visibility: "FRIENDS_ONLY", currency: "BTC", network: "bitcoin" },
				{ id: bankId, ...bank("0070-1234", "PUBLIC") },
			]),
			c.replace,
		);
		expect(second.items.map((m) => [m.type, m.rank])).toEqual([
			["crypto", 1],
			["bank", 2],
		]);
		const listed = await expectBody<{ items: Method[] }>(
			await call("/payment-methods", { headers: asSofia }),
			c.list,
		);
		expect(listed.items.map((m) => m.id)).toEqual(second.items.map((m) => m.id));
		expect(await adminDb.paymentMethod.count({ where: { userId: sofia.user.id } })).toBe(2);
	});

	it("never touches another user's methods", async () => {
		const mine = await adminDb.paymentMethod.findFirstOrThrow({
			where: { userId: sofia.user.id },
		});
		await expectProblem(
			await put(asStranger, [{ id: mine.id, ...bank("hijack") }]),
			404,
			"not_found",
		);
		const row = await adminDb.paymentMethod.findUniqueOrThrow({ where: { id: mine.id } });
		expect(row.identifier).not.toBe("hijack");
		expect(await adminDb.paymentMethod.count({ where: { userId: sofia.user.id } })).toBe(2);
		const strangers = await expectBody<{ items: Method[] }>(
			await call("/payment-methods", { headers: asStranger }),
			c.list,
		);
		expect(strangers.items).toEqual([]);
	});

	it("validates the list and wants the settings scope to write", async () => {
		await expectProblem(
			await put(asSofia, [{ type: "", visibility: "PUBLIC" }]),
			400,
			"validation_failed",
		);
		await expectProblem(
			await put(await asKey(sofia.user.id, ["read", "write:money"]), []),
			403,
			"missing_scope",
		);
		expect(await adminDb.paymentMethod.count({ where: { userId: sofia.user.id } })).toBe(2);
	});

	it("matches methods you both have, showing only what visibility allows", async () => {
		await put(asMartin, [bank("martin-bank"), { type: "crypto", identifier: "0xM", visibility: "PUBLIC", currency: "BTC", network: "lightning" }]);
		const match = await expectBody<Match>(
			await call(`/people/user/${sofia.user.id}/payment-methods`, { headers: asMartin }),
			c.match,
		);
		// Martin shares an expense with Sofia, so he sees her FRIENDS_ONLY crypto too, but
		// bitcoin is not lightning, so only the bank matches.
		expect(match.theirMethods.map((m) => m.type).sort()).toEqual(["bank", "crypto"]);
		expect(match.compatible).toMatchObject([
			{ type: "bank", theirIdentifier: "0070-1234", combinedScore: 3 },
		]);
		expect(match.theirMethods.every((m) => m.id === undefined)).toBe(true);

		// A stranger has no expense with Sofia: only her PUBLIC bank.
		await put(asStranger, [bank("stranger-bank")]);
		const open = await expectBody<Match>(
			await call(`/people/user/${sofia.user.id}/payment-methods`, { headers: asStranger }),
			c.match,
		);
		expect(open.theirMethods.map((m) => m.type)).toEqual(["bank"]);
		expect(open.theirMethods[0]?.identifier).toBe("0070-1234");
	});

	it("has nothing to match for a person without an account", async () => {
		const match = await expectBody<Match>(
			await call("/people/shadow/someone/payment-methods", { headers: asSofia }),
			c.match,
		);
		expect(match.compatible).toEqual([]);
		expect(match.theirMethods).toEqual([]);
		expect(match.yourMethods).toHaveLength(2);
	});
});
