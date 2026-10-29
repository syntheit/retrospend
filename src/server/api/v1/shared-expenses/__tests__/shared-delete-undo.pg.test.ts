/**
 * Deleting a split expense on Postgres ends in an Undo (R15). The web keeps
 * none for it; the v1 delete keeps the expense, every share and the answers
 * people gave on the server, in the caller's own stash, and one token puts all
 * of it back: same id, same shares, same answers, the same balances, the people
 * on it told it is theirs again. The token is the deleter's alone, works once,
 * and is not offered when the delete cannot be put back. Sofia adds ARS 90
 * split with Martin; Lucia is a stranger.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	ars,
	arsUser,
	seedProject,
	seedRates,
	type TestUser,
} from "../../__tests__/g3-fixtures";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract["shared-expenses"];
type Money = { minor: number; currency: string };
type Write = { id: string; undo: string };
type Deleted = { id: string; undo: string | null };
type Preview = { changes: { id: string; delta: Money }[] };

describe("deleting a split expense is undoable", () => {
	let sofia: TestUser;
	let martin: TestUser;
	let lucia: TestUser;
	let as: Record<string, string>;
	let asMartin: Record<string, string>;
	let asLucia: Record<string, string>;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const del = (id: string, body: unknown = {}, headers = as) =>
		call(`/shared-expenses/${id}`, {
			method: "DELETE",
			headers,
			body,
			idempotent: true,
		});
	const add = async (description: string, projectId?: string) =>
		expectBody<Write>(
			await post("/shared-expenses", {
				amount: "90",
				currency: "ARS",
				description,
				date: "2026-10-10",
				paidBy: { type: "user", id: sofia.user.id },
				splitWith: [
					{ type: "user", id: sofia.user.id },
					{ type: "user", id: martin.user.id },
				],
				splitMode: "EQUAL",
				...(projectId ? { projectId } : {}),
			}),
			c.create,
			201,
		);
	const owedToYou = async () =>
		(
			await expectBody<{ owedToYou: Money | null }>(
				await call("/people", { headers: as }),
				contract.people.list,
			)
		).owedToYou?.minor ?? 0;
	const row = (id: string) =>
		adminDb.sharedTransaction.findUnique({
			where: { id },
			include: {
				splitParticipants: { orderBy: { participantId: "asc" } },
				fixRequests: true,
			},
		});
	const notices = (userId: string, type: "EXPENSE_DELETED" | "EXPENSE_SPLIT") =>
		adminDb.notification.count({ where: { userId, type } });
	/** Notifications go out after the commit, so wait for the count to settle. */
	async function noticesReach(
		userId: string,
		type: "EXPENSE_DELETED" | "EXPENSE_SPLIT",
		count: number,
	) {
		for (let n = 0; n < 50; n++) {
			if ((await notices(userId, type)) === count) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		expect(await notices(userId, type)).toBe(count);
	}

	beforeAll(async () => {
		await seedRates();
		sofia = await arsUser();
		martin = await arsUser();
		lucia = await arsUser();
		as = await asMobile(sofia.user.id);
		asMartin = await asMobile(martin.user.id);
		asLucia = await asMobile(lucia.user.id);
	});

	it("answers an undo token, and the undo brings back the same expense, shares and answers", async () => {
		const made = await add("Dinner");
		// Martin has answered: his share is accepted, with a time and a category.
		const verifiedAt = new Date("2026-10-11T12:00:00.000Z");
		await adminDb.splitParticipant.updateMany({
			where: { transactionId: made.id, participantId: martin.user.id },
			data: { verificationStatus: "ACCEPTED", verifiedAt },
		});
		const before = await row(made.id);
		const owed = await owedToYou();
		expect(owed).toBeGreaterThan(0);

		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		expect(deleted.undo).toEqual(expect.any(String));
		expect(await row(made.id)).toBeNull();
		expect(await owedToYou()).toBe(owed - 4500);
		await noticesReach(martin.user.id, "EXPENSE_DELETED", 1);

		const dry = await expectBody<Preview>(
			await post("/shared-expenses/undo/preview", { token: deleted.undo }),
			c.previewUndo,
		);
		expect(dry.changes.find((x) => x.id === "owed.owedToYou")?.delta).toEqual(
			ars(4500),
		);
		expect(await row(made.id)).toBeNull();

		const undone = await expectBody<{ id: string; redo: string | null }>(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			c.undo,
		);
		expect(undone).toEqual({ id: made.id, redo: null });
		// Exactly as stored: every column of the expense and of each share.
		expect(await row(made.id)).toEqual(before);
		expect(await owedToYou()).toBe(owed);
		const martinsShare = (await row(made.id))?.splitParticipants.find(
			(s) => s.participantId === martin.user.id,
		);
		expect(martinsShare?.verificationStatus).toBe("ACCEPTED");
		expect(martinsShare?.verifiedAt).toEqual(verifiedAt);
		// Martin saw it deleted; now he is told it is his again.
		await noticesReach(martin.user.id, "EXPENSE_SPLIT", 2);
		// The audit log says what happened, and the event feed says it was undone.
		await expect(
			adminDb.auditLogEntry.count({
				where: { targetId: made.id, action: "CREATED" },
			}),
		).resolves.toBe(2);
		await expect(
			adminDb.apiEvent.count({
				where: { userId: sofia.user.id, type: "shared_expense.undone" },
			}),
		).resolves.toBeGreaterThan(0);
	});

	it("never confirms for you: the warning stays until confirmUnsettled", async () => {
		const made = await add("Unsettled");
		await expectProblem(await del(made.id), 409, "conflict");
		await expectProblem(
			await post(`/shared-expenses/${made.id}/delete/preview`, {}),
			409,
			"conflict",
		);
		expect(await row(made.id)).not.toBeNull();
	});

	it("keeps the token to the person who deleted, and spends it once", async () => {
		const made = await add("Mine");
		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		const token = deleted.undo;
		for (const stranger of [asMartin, asLucia]) {
			await expectProblem(
				await post("/shared-expenses/undo", { token }, stranger),
				400,
				"bad_request",
			);
			await expectProblem(
				await post("/shared-expenses/undo/preview", { token }, stranger),
				400,
				"bad_request",
			);
		}
		expect(await row(made.id)).toBeNull();

		await expectBody(await post("/shared-expenses/undo", { token }), c.undo);
		expect(await row(made.id)).not.toBeNull();
		const owed = await owedToYou();
		await expectProblem(
			await post("/shared-expenses/undo", { token }),
			409,
			"conflict",
		);
		expect(await owedToYou()).toBe(owed);
	});

	it("refuses an undo whose stash is gone or was taken, and one that came back already", async () => {
		const made = await add("Twice");
		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		await adminDb.idempotencyKey.deleteMany({
			where: { userId: sofia.user.id, key: { startsWith: "undo-stash:" } },
		});
		await expectProblem(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			400,
			"bad_request",
		);
		expect(await row(made.id)).toBeNull();
	});

	it("gives no token for a delete someone else added", async () => {
		// Martin did not add it: he may not delete it either (403), so no token exists.
		const made = await add("Sofia's");
		await expectProblem(
			await del(made.id, { confirmUnsettled: true }, asMartin),
			403,
			"forbidden",
		);
		expect(await row(made.id)).not.toBeNull();
	});

	it("keeps the requests to fix it that involve you", async () => {
		const made = await add("Fix me");
		await adminDb.fixRequest.create({
			data: {
				id: randomUUID(),
				transactionId: made.id,
				requestedByType: "user",
				requestedById: martin.user.id,
				askedType: "user",
				askedId: sofia.user.id,
				message: "Wrong amount",
				status: "PENDING",
			},
		});
		const before = await row(made.id);
		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		expect(
			await adminDb.fixRequest.count({ where: { transactionId: made.id } }),
		).toBe(0);
		await expectBody(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			c.undo,
		);
		expect(await row(made.id)).toEqual(before);
	});

	it("refuses an undo when someone on it left the project, and works again once they are back", async () => {
		const projectId = await seedProject(sofia, [
			{ user: martin, role: "CONTRIBUTOR" },
		]);
		const made = await add("Trip dinner", projectId);
		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		await adminDb.projectParticipant.deleteMany({
			where: { projectId, participantId: martin.user.id },
		});
		await expectProblem(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			409,
			"conflict",
		);
		expect(await row(made.id)).toBeNull();
		// The refusal wrote nothing and spent nothing: back in the project, it works.
		await adminDb.projectParticipant.create({
			data: {
				projectId,
				participantType: "user",
				participantId: martin.user.id,
				role: "CONTRIBUTOR",
			},
		});
		await expectBody(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			c.undo,
		);
		expect((await row(made.id))?.projectId).toBe(projectId);
	});

	it("refuses an undo when its billing period is no longer open", async () => {
		const projectId = await seedProject(sofia, [
			{ user: martin, role: "CONTRIBUTOR" },
		]);
		const period = await adminDb.billingPeriod.create({
			data: {
				projectId,
				label: "October",
				startDate: new Date("2026-10-01"),
				endDate: new Date("2026-10-31"),
				status: "OPEN",
			},
		});
		const made = await add("Period dinner", projectId);
		expect((await row(made.id))?.billingPeriodId).toBe(period.id);
		const deleted = await expectBody<Deleted>(
			await del(made.id, { confirmUnsettled: true }),
			c.delete,
		);
		await adminDb.billingPeriod.update({
			where: { id: period.id },
			data: { status: "CLOSED", closedAt: new Date() },
		});
		await expectProblem(
			await post("/shared-expenses/undo", { token: deleted.undo }),
			409,
			"conflict",
		);
		expect(await row(made.id)).toBeNull();
	});

	it("says before the tap that a delete cannot be undone", async () => {
		const mine = await add("Undoable");
		const dry = await expectBody<{
			detail?: { kind: string; undoable: boolean };
		}>(
			await post(`/shared-expenses/${mine.id}/delete/preview`, {
				confirmUnsettled: true,
			}),
			c.previewDelete,
		);
		expect(dry.detail).toEqual({
			kind: "sharedExpense.delete",
			undoable: true,
		});
		const voided = await expectBody<{
			detail?: { kind: string; undoable: boolean };
		}>(
			await post(`/shared-expenses/${mine.id}/delete/preview`, {
				confirmUnsettled: true,
				settled: "VOID_PAYMENT",
			}),
			c.previewDelete,
		);
		expect(voided.detail).toEqual({
			kind: "sharedExpense.delete",
			undoable: false,
		});
		expect(await row(mine.id)).not.toBeNull();
	});
});
