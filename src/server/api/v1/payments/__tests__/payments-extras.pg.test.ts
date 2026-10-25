/**
 * Withdrawing a payment and squaring up projects on Postgres: previews that
 * write nothing, the delete of a waiting payment, the void of one that became
 * final without agreement, offsets with no cash, undo through the payment
 * token, idempotent replay and who may do what. Sofia and Martin share two
 * projects: Trip, where Martin owes her ARS 100, and Rent, where she owes him
 * ARS 100. A ghost Juan makes the auto-final case.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
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

const c = contract.payments;
type Preview = { changes: unknown[]; unchanged: unknown[] };

describe("payment removal and square up", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;
	let asStranger: Record<string, string>;

	const send = (
		method: string,
		path: string,
		headers: Record<string, string>,
		body?: unknown,
		key?: string,
	) => call(path, { method, headers, body, idempotent: key ?? true });
	const payments = (userId: string) =>
		adminDb.payment.count({
			where: { OR: [{ payerId: userId }, { payeeId: userId }] },
		});

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, lucia, stranger] = [
			await arsUser(),
			await arsUser(),
			await arsUser(),
			await arsUser(),
		];
		[asSofia, asMartin, asLucia, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(lucia.user.id),
			await asMobile(stranger.user.id),
		];
	});

	it("withdraws a payment still waiting, after a preview, for its recorder only", async () => {
		const project = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		await seedShare(ref(martin), ref(sofia), "5000", "ARS", {
			projectId: project,
		});
		const made = await expectBody<{ id: string; status: string }>(
			await send("POST", "/payments", asSofia, {
				person: { type: "user", id: martin.user.id },
				direction: "outgoing",
				currency: "ARS",
				amount: "2000",
			}),
			c.record,
			201,
		);
		expect(made.status).toBe("PROPOSED");

		// Only the one who recorded it withdraws it.
		await expectProblem(
			await send("DELETE", `/payments/${made.id}`, asMartin),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("DELETE", `/payments/${made.id}`, asStranger),
			404,
			"not_found",
		);

		const preview = await expectBody<Preview>(
			await send("POST", `/payments/${made.id}/preview`, asSofia, {}),
			c.previewRemove,
		);
		expect(preview.changes.length).toBeGreaterThan(0);
		expect(await payments(sofia.user.id)).toBe(1);

		const key = randomUUID();
		const removed = await expectBody<{ id: string; mode: string }>(
			await send("DELETE", `/payments/${made.id}`, asSofia, undefined, key),
			c.remove,
		);
		expect(removed).toEqual({ id: made.id, mode: "delete" });
		expect(await payments(sofia.user.id)).toBe(0);
		const replay = await send("DELETE", `/payments/${made.id}`, asSofia, undefined, key);
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
	});

	it("voids a payment that became final without the other person's say", async () => {
		const project = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		const juan = await adminDb.shadowProfile.create({
			data: { createdById: sofia.user.id, name: "Juan" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: project,
				participantType: "shadow",
				participantId: juan.id,
				role: "CONTRIBUTOR",
			},
		});
		await seedShare(
			ref(sofia),
			{ participantType: "shadow", participantId: juan.id },
			"3000",
			"ARS",
			{ projectId: project },
		);
		const made = await expectBody<{ id: string; status: string }>(
			await send("POST", "/payments", asSofia, {
				person: { type: "shadow", id: juan.id },
				direction: "incoming",
				currency: "ARS",
				amount: "1000",
			}),
			c.record,
			201,
		);
		expect(made.status).toBe("FINALIZED");
		const removed = await expectBody<{ mode: string }>(
			await send("DELETE", `/payments/${made.id}`, asSofia),
			c.remove,
		);
		expect(removed.mode).toBe("void");
		expect(await adminDb.payment.count({ where: { id: made.id } })).toBe(0);
	});

	it("needs write:money to withdraw", async () => {
		const expensesOnly = await asKey(sofia.user.id, ["read", "write:expenses"]);
		await expectProblem(
			await send("DELETE", `/payments/${randomUUID()}`, expensesOnly),
			403,
			"missing_scope",
		);
	});

	describe("square up", () => {
		// A pair of their own, so the debts of the tests above do not count.
		let ann: TestUser;
		let bob: TestUser;
		let asAnn: Record<string, string>;

		beforeAll(async () => {
			[ann, bob] = [await arsUser(), await arsUser()];
			asAnn = await asMobile(ann.user.id);
			// Trip: Ann paid ARS 100 that Bob owes. Rent: Bob paid ARS 100 that Ann owes.
			const trip = await seedProject(ann, [{ user: bob, role: "EDITOR" }]);
			const rent = await seedProject(bob, [{ user: ann, role: "EDITOR" }]);
			await seedShare(ref(ann), ref(bob), "100", "ARS", {
				projectId: trip,
				title: "Trip",
			});
			await seedShare(ref(bob), ref(ann), "100", "ARS", {
				projectId: rent,
				title: "Rent",
			});
		});

		it("offers the currency where the totals are even but the projects are not", async () => {
			const options = await expectBody<{
				items: {
					currency: string;
					amount: { minor: number };
					scopes: { balance: { minor: number } }[];
				}[];
			}>(
				await call(`/people/user/${bob.user.id}/square-up`, {
					headers: asAnn,
				}),
				c.squareUpOptions,
			);
			expect(options.items).toHaveLength(1);
			expect(options.items[0]).toMatchObject({
				currency: "ARS",
				amount: { minor: 10_000 },
			});
			expect(
				options.items[0]?.scopes.map((s) => s.balance.minor).sort((a, b) => a - b),
			).toEqual([-10_000, 10_000]);
			// Only people you share with.
			await expectProblem(
				await call(`/people/user/${lucia.user.id}/square-up`, { headers: asAnn }),
				404,
				"not_found",
			);
		});

		it("previews without writing, then records offsets only and takes them back", async () => {
			const body = { person: { type: "user", id: bob.user.id }, currency: "ARS" };
			const before = await payments(ann.user.id);
			const preview = await expectBody<Preview>(
				await send("POST", "/payments/square-up/preview", asAnn, body),
				c.previewSquareUp,
			);
			expect(preview.unchanged.length + preview.changes.length).toBeGreaterThan(0);
			expect(await payments(ann.user.id)).toBe(before);

			const key = randomUUID();
			const done = await expectBody<{ id: string; status: string; undo: string }>(
				await send("POST", "/payments/square-up", asAnn, body, key),
				c.squareUp,
				201,
			);
			// Martin is on Retrospend, so he confirms or rejects it.
			expect(done.status).toBe("PROPOSED");
			const rows = await adminDb.settlement.findMany({
				where: { paymentGroupId: done.id },
			});
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.every((r) => r.isOffset)).toBe(true);
			const replay = await send("POST", "/payments/square-up", asAnn, body, key);
			expect(replay.headers.get("idempotent-replayed")).toBe("true");
			expect(await payments(ann.user.id)).toBe(before + 1);

			await expectBody(
				await send("POST", "/payments/undo", asAnn, { token: done.undo }),
				c.undo,
			);
			expect(await payments(ann.user.id)).toBe(before);
		});

		it("refuses a currency with nothing to square up, a stranger and a missing scope", async () => {
			await expectProblem(
				await send("POST", "/payments/square-up", asAnn, {
					person: { type: "user", id: bob.user.id },
					currency: "BRL",
				}),
				400,
				"bad_request",
			);
			await expectProblem(
				await send("POST", "/payments/square-up", asAnn, {
					person: { type: "user", id: stranger.user.id },
					currency: "ARS",
				}),
				404,
				"not_found",
			);
			await expectProblem(
				await send(
					"POST",
					"/payments/square-up",
					await asKey(ann.user.id, ["read", "write:expenses"]),
					{ person: { type: "user", id: bob.user.id }, currency: "ARS" },
				),
				403,
				"missing_scope",
			);
		});
	});
});
