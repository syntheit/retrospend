/**
 * Taking back a first set-up over /api/v1/budget: the set-up answers an undo
 * token for POST /budget/undo, the preview leaves the budget, the undo answers
 * `setup.undo` and the month reads as no budget, a token spends once (a
 * replay is 409), and a budget that holds an assign since answers 409 and
 * keeps its token usable for nothing. USD, Flex fixture: Rent 500.00 and
 * Dining 200.00 planned from 1,000.00, so 300.00 is left to plan.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { adminDb } from "~/test/pg-harness";
import { call, expectBody, expectProblem } from "../../core/__tests__/harness";
import { mobileFrom, toV1, uuid } from "./fixtures";

const asMobile = mobileFrom("198.51.100.84");

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Write = { result: Record<string, unknown>; undo: string | null };
type Preview = { detail?: { kind: string; result: unknown } };

describe("/api/v1/budget undo of a first set-up", () => {
	let as: Record<string, string>;
	let other: Record<string, string>;
	let rent: string;
	let token: string;
	let userId: string;
	let otherId: string;
	let otherToken: string;
	let flexBody: unknown;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body: toV1(body), idempotent: true });
	const books = (id: string) =>
		adminDb.budgetBook.count({ where: { createdById: id } });
	const month = async (headers = as) =>
		call("/budget/month", { headers }).then((r) =>
			expectBody<{ toAssign: { amount: { minor: number } } } | null>(
				r,
				c.month,
			),
		);

	beforeAll(async () => {
		const s = await seedUser();
		const t = await seedUser();
		userId = s.user.id;
		otherId = t.user.id;
		as = await asMobile(userId);
		other = await asMobile(otherId);
		const flex = (x: typeof s) => ({ ...setupInput(x), style: "FLEX" });
		flexBody = flex(s);
		const started = await expectBody<Write>(
			await post("/budget/setup", flexBody),
			c.setup,
			201,
		);
		token = started.undo as string;
		// The web's signed footprint is not part of the v1 answer.
		expect(started.result).not.toHaveProperty("restore");
		const second = await expectBody<Write>(
			await post("/budget/setup", flex(t), other),
			c.setup,
			201,
		);
		otherToken = second.undo as string;
		rent = (
			await adminDb.envelope.findFirstOrThrow({
				where: { book: { createdById: userId }, sortOrder: 0 },
			})
		).id;
	});

	it("hands out a token for each start", () => {
		expect(token).toEqual(expect.any(String));
		expect(otherToken).not.toBe(token);
	});

	it("previews the undo and leaves the budget", async () => {
		expect((await month())?.toAssign.amount.minor).toBe(30_000);
		const preview = await expectBody<Preview>(
			await post("/budget/undo/preview", { token }),
			c.previewUndo,
		);
		expect(preview.detail?.kind).toBe("setup.undo");
		expect(await books(userId)).toBe(1);
	});

	it("keeps one person's token away from another", async () => {
		await expectProblem(
			await post("/budget/undo", { token }, other),
			400,
			"bad_request",
		);
		expect(await books(userId)).toBe(1);
		expect(await books(otherId)).toBe(1);
	});

	it("refuses once the budget holds an assign, and the book stays", async () => {
		const [month] = await adminDb.$queryRaw<{ m: number }[]>`
			SELECT "startMonth" AS m FROM "budget_book" WHERE "createdById" = ${otherId}`;
		const otherRent = await adminDb.envelope.findFirstOrThrow({
			where: { book: { createdById: otherId }, sortOrder: 0 },
		});
		await expectBody(
			await post(
				"/budget/assign",
				{
					batchId: uuid(),
					month: month?.m,
					mode: "add",
					items: [{ id: uuid(), envelopeId: otherRent.id, amountMinor: 100 }],
				},
				other,
			),
			c.assign,
		);
		await expectProblem(
			await post("/budget/undo", { token: otherToken }, other),
			409,
			"conflict",
		);
		expect(await books(otherId)).toBe(1);
	});

	it("undoes the start, answers setup.undo, and a replay is 409", async () => {
		const done = await expectBody<{
			result: {
				kind: string;
				result: { bookId: string; expenseId: string | null };
			};
		}>(await post("/budget/undo", { token }), c.undo);
		expect(done.result.kind).toBe("setup.undo");
		expect(done.result.result.expenseId).toEqual(expect.any(String));
		expect(await books(userId)).toBe(0);
		expect(await month()).toBeNull();
		await expectProblem(await post("/budget/undo", { token }), 409, "conflict");
		// The envelope the first budget had is gone with it.
		await expect(adminDb.envelope.count({ where: { id: rent } })).resolves.toBe(
			0,
		);
	});

	it("starts again from nothing: only what the new start is given", async () => {
		await expectBody<Write>(
			await post("/budget/setup", flexBody),
			c.setup,
			201,
		);
		expect(await books(userId)).toBe(1);
		// 100,000 from 1,000.00 less 70,000 planned: nothing carried over.
		expect((await month())?.toAssign.amount.minor).toBe(30_000);
	});
});
