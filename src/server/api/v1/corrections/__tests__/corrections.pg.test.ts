/**
 * /api/v1 corrections and Ask to fix on Postgres, through the web's own
 * mutations: previews that write nothing, undo tokens, idempotent replay and
 * who may do what. Fixture (ARS home, one project): Sofia added an expense
 * of ARS 18,000 that Martin owes in full; a payment locked it.
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
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.corrections;
type Preview = { changes: unknown[]; unchanged: { id: string }[] };
type Request = { id: string; expenseId: string; status: string };
type RequestWrite = {
	request: Request;
	previousStatus: string | null;
	undo: string;
};
type Correction = {
	correctionIds: string[];
	differences: {
		person: { id: string };
		paid: { minor: number };
		share: { minor: number };
	}[];
	resolvedRequests: { id: string; previousStatus: string }[];
	undo: string | null;
};
type Undone = { kind: string; redo: string | null; request?: Request };

describe("/api/v1 corrections and Ask to fix", () => {
	useApiV1();
	let sofia: TestUser;
	let martin: TestUser;
	let stranger: TestUser;
	let asSofia: Record<string, string>;
	let asMartin: Record<string, string>;
	let asStranger: Record<string, string>;
	let split: string;

	const post = (path: string, body: unknown, headers: Record<string, string>) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const fixCount = () => adminDb.fixRequest.count();
	const ask = async (headers = asMartin, requestId = randomUUID()) =>
		expectBody<RequestWrite>(
			await post(
				`/shared-expenses/${split}/fix-requests`,
				{ requestId, message: "Wrong total" },
				headers,
			),
			c.askToFix,
			201,
		);
	const correctBody = (amount = "20000") => ({
		description: "Correction to Shared",
		amount,
		paidBy: { type: "user", id: sofia.user.id },
		categoryId: null,
		splitMode: "EXACT",
		splitWith: [
			{ type: "user", id: martin.user.id, shareAmount: amount },
			{ type: "user", id: sofia.user.id, shareAmount: "0" },
		],
	});

	beforeAll(async () => {
		await seedRates();
		[sofia, martin, stranger] = [await arsUser(), await arsUser(), await arsUser()];
		[asSofia, asMartin, asStranger] = [
			await asMobile(sofia.user.id),
			await asMobile(martin.user.id),
			await asMobile(stranger.user.id),
		];
		const trip = await seedProject(sofia, [{ user: martin, role: "EDITOR" }]);
		split = (
			await seedShare(ref(sofia), ref(martin), "18000", "ARS", {
				projectId: trip,
			})
		).id;
		await adminDb.sharedTransaction.update({
			where: { id: split },
			data: { isLocked: true },
		});
	});

	it("says who may correct and who may ask", async () => {
		const states = async (headers: Record<string, string>) =>
			(
				await expectBody<{
					items: { expenseId: string; canCorrect: boolean; canAskToFix: boolean }[];
				}>(
					await call(`/shared-expenses/lock-states?ids=${split},nope`, {
						headers,
					}),
					c.lockStates,
				)
			).items;
		expect(await states(asSofia)).toMatchObject([
			{ expenseId: split, canCorrect: true, canAskToFix: false },
		]);
		expect(await states(asMartin)).toMatchObject([
			{ expenseId: split, canCorrect: false, canAskToFix: true },
		]);
		expect(await states(asStranger)).toEqual([]);
	});

	it("previews asking without writing, then asks, replays and withdraws", async () => {
		const before = await fixCount();
		const requestId = randomUUID();
		const body = { requestId, message: "Wrong total" };
		const preview = await expectBody<Preview>(
			await post(`/shared-expenses/${split}/fix-requests/preview`, body, asMartin),
			contract.corrections.previewAskToFix,
		);
		expect(preview.changes).toEqual([]);
		expect(await fixCount()).toBe(before);

		const key = randomUUID();
		const send = () =>
			call(`/shared-expenses/${split}/fix-requests`, {
				method: "POST",
				headers: asMartin,
				body,
				idempotent: key,
			});
		const made = await expectBody<RequestWrite>(await send(), c.askToFix, 201);
		expect(made.request).toMatchObject({
			id: requestId,
			expenseId: split,
			status: "PENDING",
		});
		const again = await send();
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect((await again.json()).request.id).toBe(requestId);
		expect(await fixCount()).toBe(before + 1);

		// The asker and the asked see it; a stranger does not even see the expense.
		for (const headers of [asMartin, asSofia]) {
			const list = await expectBody<{ items: Request[] }>(
				await call(`/shared-expenses/${split}/fix-requests`, { headers }),
				c.fixRequests,
			);
			expect(list.items.map((r) => r.id)).toEqual([requestId]);
		}
		await expectProblem(
			await call(`/shared-expenses/${split}/fix-requests`, {
				headers: asStranger,
			}),
			404,
			"not_found",
		);

		const undone = await expectBody<Undone>(
			await post("/corrections/undo", { token: made.undo }, asMartin),
			c.undo,
		);
		expect(undone).toMatchObject({ kind: "fixRequest.withdraw", redo: null });
		expect(await fixCount()).toBe(before);
		// A token works once.
		await expectProblem(
			await post("/corrections/undo", { token: made.undo }, asMartin),
			409,
			"conflict",
		);
	});

	it("refuses asking twice, asking your own expense and a stranger", async () => {
		const first = await ask();
		await expectProblem(
			await post(
				`/shared-expenses/${split}/fix-requests`,
				{ message: "again" },
				asMartin,
			),
			409,
			"conflict",
		);
		await expectProblem(
			await post(`/shared-expenses/${split}/fix-requests`, {}, asSofia),
			400,
			"bad_request",
		);
		await expectProblem(
			await post(`/shared-expenses/${split}/fix-requests`, {}, asStranger),
			404,
			"not_found",
		);
		// Clean up for the next tests.
		await post("/corrections/undo", { token: first.undo }, asMartin);
	});

	it("answers and cancels with previews, and takes each back", async () => {
		const made = await ask();
		const id = made.request.id;

		// Only the person asked can answer.
		await expectProblem(
			await post(`/fix-requests/${id}/respond`, { response: "accept" }, asMartin),
			404,
			"not_found",
		);
		await expectProblem(
			await post(`/fix-requests/${id}/respond`, { response: "accept" }, asStranger),
			404,
			"not_found",
		);
		await post(
			`/fix-requests/${id}/respond/preview`,
			{ response: "decline" },
			asSofia,
		);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id } })).status,
		).toBe("PENDING");

		const answered = await expectBody<RequestWrite>(
			await post(
				`/fix-requests/${id}/respond`,
				{ response: "accept", reply: "I will fix it" },
				asSofia,
			),
			c.respondToFix,
		);
		expect(answered).toMatchObject({
			previousStatus: "PENDING",
			request: { status: "ACCEPTED" },
		});
		const back = await expectBody<Undone>(
			await post("/corrections/undo", { token: answered.undo }, asSofia),
			c.undo,
		);
		expect(back).toMatchObject({
			kind: "fixRequest.restore",
			request: { status: "PENDING" },
		});

		// Only the asker can cancel; the cancel is taken back to what it was.
		await expectProblem(
			await post(`/fix-requests/${id}/cancel`, {}, asSofia),
			404,
			"not_found",
		);
		const cancelled = await expectBody<RequestWrite>(
			await post(`/fix-requests/${id}/cancel`, {}, asMartin),
			c.cancelFix,
		);
		expect(cancelled.request.status).toBe("CANCELLED");
		await expectBody(
			await post("/corrections/undo", { token: cancelled.undo }, asMartin),
			c.undo,
		);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id } })).status,
		).toBe("PENDING");
	});

	it("corrects a locked split: preview first, then the rows, then undo", async () => {
		const before = await adminDb.sharedTransaction.count();
		const request = (
			await adminDb.fixRequest.findFirstOrThrow({
				where: { transactionId: split, status: "PENDING" },
			})
		).id;

		await expectProblem(
			await post(
				`/shared-expenses/${split}/corrections`,
				correctBody(),
				asMartin,
			),
			403,
			"forbidden",
		);
		await expectProblem(
			await post(
				`/shared-expenses/${split}/corrections`,
				correctBody(),
				asStranger,
			),
			404,
			"not_found",
		);

		const preview = await expectBody<Preview>(
			await post(
				`/shared-expenses/${split}/corrections/preview`,
				correctBody(),
				asSofia,
			),
			c.previewCorrect,
		);
		expect(preview.changes.length).toBeGreaterThan(0);
		expect(await adminDb.sharedTransaction.count()).toBe(before);

		const key = randomUUID();
		const body = { ...correctBody(), correctionId: randomUUID() };
		const done = await expectBody<Correction>(
			await call(`/shared-expenses/${split}/corrections`, {
				method: "POST",
				headers: asSofia,
				body,
				idempotent: key,
			}),
			c.correct,
			201,
		);
		// Martin owes ARS 2,000 more: 20,000 against 18,000.
		expect(done.correctionIds).toHaveLength(1);
		const martinLine = done.differences.find(
			(d) => d.person.id === martin.user.id,
		);
		expect(martinLine?.share.minor).toBe(200_000);
		expect(done.resolvedRequests).toEqual([
			{ id: request, previousStatus: "PENDING" },
		]);
		expect(await adminDb.sharedTransaction.count()).toBe(before + 1);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: request } }))
				.status,
		).toBe("FIXED");

		const replay = await call(`/shared-expenses/${split}/corrections`, {
			method: "POST",
			headers: asSofia,
			body,
			idempotent: key,
		});
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(await adminDb.sharedTransaction.count()).toBe(before + 1);

		const undo = done.undo as string;
		const undoPreview = await expectBody<Preview>(
			await post("/corrections/undo/preview", { token: undo }, asSofia),
			c.previewUndo,
		);
		expect(undoPreview.changes.length).toBeGreaterThan(0);
		expect(await adminDb.sharedTransaction.count()).toBe(before + 1);

		// Another user's token is not valid for you.
		await expectProblem(
			await post("/corrections/undo", { token: undo }, asMartin),
			400,
			"bad_request",
		);
		const undone = await expectBody<Undone>(
			await post("/corrections/undo", { token: undo }, asSofia),
			c.undo,
		);
		expect(undone.kind).toBe("correction.undo");
		expect(await adminDb.sharedTransaction.count()).toBe(before);
		expect(
			(await adminDb.fixRequest.findUniqueOrThrow({ where: { id: request } }))
				.status,
		).toBe("PENDING");
	});

	it("writes nothing and answers no undo when the correction changes nothing", async () => {
		const before = await adminDb.sharedTransaction.count();
		const done = await expectBody<Correction>(
			await post(
				`/shared-expenses/${split}/corrections`,
				correctBody("18000"),
				asSofia,
			),
			c.correct,
			201,
		);
		expect(done.correctionIds).toEqual([]);
		expect(done.undo).toBeNull();
		expect(await adminDb.sharedTransaction.count()).toBe(before);
	});

	it("records an event for each write", async () => {
		const types = (
			await adminDb.apiEvent.findMany({
				where: { userId: { in: [martin.user.id, sofia.user.id] } },
			})
		).map((e) => e.type);
		for (const type of [
			"fix_request.created",
			"fix_request.answered",
			"fix_request.cancelled",
			"shared_expense.corrected",
			"correction.undone",
		])
			expect(types, type).toContain(type);
	});
});
