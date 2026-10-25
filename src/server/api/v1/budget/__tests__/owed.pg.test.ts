/**
 * /api/v1/budget money owed and splits on Postgres: forgive what a person
 * owes, pick the category of a split share, route a project's shares. USD
 * book. The fixture is the web's own (splits.pg.test.ts): an asado of USD 90
 * for me, Sam and Paz that I paid for, in my Dining; Sam paid his 30 back.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getOwed } from "~/server/services/envelope/read.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";
import { bookedUser, useBudgetV1, withoutStamps } from "./fixtures";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.budget;
type Preview = {
	changes: { id: string; delta: { minor: number } }[];
	detail?: { kind: string; result: unknown };
};
type Write = { result: Record<string, unknown>; undo: string | null };
type Party = { type: "user" | "shadow"; id: string };

function split(p: {
	paidBy: Party;
	amount: number;
	categoryId?: string | null;
	shares: Array<[Party, number]>;
}) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Split",
			amount: new Prisma.Decimal(p.amount),
			currency: "USD",
			date: new Date(),
			categoryId: p.categoryId ?? null,
			paidByType: p.paidBy.type,
			paidById: p.paidBy.id,
			createdByType: p.paidBy.type,
			createdById: p.paidBy.id,
			splitParticipants: {
				create: p.shares.map(([who, share]) => ({
					participantType: who.type,
					participantId: who.id,
					shareAmount: new Prisma.Decimal(share),
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

async function payBack(from: Party, to: Party, amount: number) {
	const id = randomUUID();
	await adminDb.payment.create({
		data: {
			id,
			payerType: from.type,
			payerId: from.id,
			payeeType: to.type,
			payeeId: to.id,
			amount: new Prisma.Decimal(amount),
			currency: "USD",
			paidOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
			recordedByType: "user",
			recordedById: to.id,
			status: "FINALIZED",
		},
	});
	await adminDb.settlement.create({
		data: {
			fromParticipantType: from.type,
			fromParticipantId: from.id,
			toParticipantType: to.type,
			toParticipantId: to.id,
			amount: new Prisma.Decimal(amount),
			currency: "USD",
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
			settledAt: new Date(),
			paymentGroupId: id,
		},
	});
}

describe("/api/v1/budget owed and splits", () => {
	useApiV1();
	useBudgetV1();
	let as: Record<string, string>;
	let stranger: Record<string, string>;
	let ids: Record<string, string>;
	let diningCategory: string;
	let userId: string;
	let paz: Party;
	let project: string;

	const post = (path: string, body: unknown, headers = as) =>
		call(path, { method: "POST", headers, body, idempotent: true });
	const undo = (token: string | null) => post("/budget/undo", { token });
	const owedTo = async (who: Party) =>
		(await getOwed(userId))?.people.find((p) => p.participant.id === who.id)
			?.lines[0]?.amount.minor ?? 0;

	beforeAll(async () => {
		const me = await bookedUser();
		userId = me.user.id;
		ids = me.ids;
		diningCategory = me.dining;
		as = await asMobile(userId);
		stranger = await asMobile((await createTestUser()).user.id);
		const meP: Party = { type: "user", id: userId };
		const sam = (await createTestUser()).user;
		const samP: Party = { type: "user", id: sam.id };
		paz = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: userId, name: "Paz" },
				})
			).id,
		};
		await split({
			paidBy: meP,
			amount: 90,
			categoryId: me.dining,
			shares: [
				[meP, 30],
				[samP, 30],
				[paz, 30],
			],
		});
		await payBack(samP, meP, 30);
		project = (
			await adminDb.project.create({
				data: {
					name: "Trip",
					createdById: userId,
					participants: {
						create: [
							{
								participantType: "user",
								participantId: userId,
								role: "ORGANIZER",
							},
							{ participantType: "user", participantId: sam.id },
						],
					},
				},
			})
		).id;
	});

	it("lists what people owe the budget holds", async () => {
		const owed = await expectBody<{
			held: { minor: number };
			people: { name: string | null }[];
		}>(await call("/budget/owed", { headers: as }), c.owed);
		expect(owed.held.minor).toBe(3_000);
		expect(owed.people.map((p) => p.name)).toContain("Paz");
	});

	it("forgives Paz's 30 into Dining with a preview, and takes it back", async () => {
		const body = {
			id: randomUUID(),
			participant: paz,
			currency: "USD",
			amountMinor: 3_000,
			envelopeId: ids.Dining,
		};
		const preview = await expectBody<Preview>(
			await post("/budget/forgive/preview", body),
			c.previewForgive,
		);
		expect(
			preview.changes.find((x) => x.id === "budget.notPlannedYet")?.delta,
		).toEqual({ minor: 3_000, currency: "USD" });
		expect(await owedTo(paz)).toBe(3_000);

		const written = await expectBody<Write>(
			await post("/budget/forgive", body),
			c.forgive,
		);
		expect(withoutStamps(written.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		expect(await owedTo(paz)).toBe(0);

		const undone = await expectBody<{ result: { kind: string } }>(
			await undo(written.undo),
			c.undo,
		);
		expect(undone.result.kind).toBe("forgive.undo");
		expect(await owedTo(paz)).toBe(3_000);
		await expectProblem(await undo(written.undo), 409, "conflict");
	});

	it("refuses to forgive more than is owed, and what is owed to someone else", async () => {
		await expectProblem(
			await post("/budget/forgive", {
				id: randomUUID(),
				participant: paz,
				currency: "USD",
				amountMinor: 999_999,
				envelopeId: null,
			}),
			400,
			"bad_request",
		);
		await expectProblem(
			await post(
				"/budget/forgive",
				{
					id: randomUUID(),
					participant: paz,
					currency: "USD",
					amountMinor: 100,
					envelopeId: null,
				},
				stranger,
			),
			400,
			"bad_request",
		);
		expect(await owedTo(paz)).toBe(3_000);
	});

	it("picks the category of a share and refuses a stale undo", async () => {
		const sam = (await createTestUser()).user;
		const food = await adminDb.category.create({
			data: { name: "Food", color: "red", userId: sam.id },
		});
		const t = await split({
			paidBy: { type: "user", id: sam.id },
			amount: 40,
			categoryId: food.id,
			shares: [
				[{ type: "user", id: sam.id }, 20],
				[{ type: "user", id: userId }, 20],
			],
		});
		const first = await expectBody<Write>(
			await post("/budget/share-category", {
				transactionId: t.id,
				categoryId: diningCategory,
				source: "USER",
			}),
			c.setShareCategory,
		);
		expect(first.result.categoryId).toBe(diningCategory);
		const second = await expectBody<Write>(
			await post("/budget/share-category", {
				transactionId: t.id,
				categoryId: null,
				source: "USER",
			}),
			c.setShareCategory,
		);
		await expectProblem(await undo(first.undo), 409, "conflict");
		const undone = await expectBody<{ result: { kind: string } }>(
			await undo(second.undo),
			c.undo,
		);
		expect(undone.result.kind).toBe("share_category.set");
		await expect(
			adminDb.splitParticipant.findFirst({
				where: { transactionId: t.id, participantId: userId },
			}),
		).resolves.toMatchObject({ categoryId: diningCategory });
	});

	it("routes a project's shares into one envelope and puts the old routing back", async () => {
		const body = {
			projectId: project,
			routing: "ENVELOPE",
			envelopeId: ids.Rent,
		};
		const preview = await expectBody<Preview>(
			await post("/budget/project-routing/preview", body),
			c.previewSetProjectRouting,
		);
		const first = await expectBody<Write>(
			await post("/budget/project-routing", body),
			c.setProjectRouting,
		);
		expect(withoutStamps(first.result)).toEqual(
			withoutStamps(preview.detail?.result),
		);
		const second = await expectBody<Write>(
			await post("/budget/project-routing", {
				projectId: project,
				routing: "NOT_IN_BUDGET",
				envelopeId: null,
			}),
			c.setProjectRouting,
		);
		await expectProblem(await undo(first.undo), 409, "conflict");
		await expectBody(await undo(second.undo), c.undo);
		await expect(
			adminDb.projectParticipant.findFirst({
				where: { projectId: project, participantId: userId },
			}),
		).resolves.toMatchObject({
			budgetRouting: "ENVELOPE",
			budgetEnvelopeId: ids.Rent,
		});
		await expectProblem(
			await post("/budget/project-routing", body, stranger),
			404,
			"not_found",
		);
	});
});
