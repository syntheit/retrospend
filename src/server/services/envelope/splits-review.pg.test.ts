/**
 * Review fixes for splits in the budget (P3), on a real Postgres: deleting
 * a split that payments covered keeps the credit or voids the payment
 * (D12, S17), each previewed; a payment confirm previews its budget change;
 * a forgive without an envelope is dated in the user's zone; the project
 * routing undo names the participant row. USD; amounts in minor units.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { deleteSharedExpense } from "~/server/services/entry/shared.mutation";
import { confirmPayment } from "~/server/services/payments/confirm.mutation";
import { forUser } from "~/server/services/preview";
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";
import { setProjectRoutingMutation } from "./splits.mutation";
import { forgive } from "./splits.service";

const usd = (minor: number) => ({ minor, currency: "USD" });
type Party = { type: "user" | "shadow"; id: string };

function split(
	paidBy: Party,
	shares: Array<[Party, number]>,
	categoryId: string | null = null,
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Rental",
			amount: new Prisma.Decimal(shares.reduce((t, [, v]) => t + v, 0)),
			currency: "USD",
			date: new Date(),
			categoryId,
			paidByType: paidBy.type,
			paidById: paidBy.id,
			createdByType: paidBy.type,
			createdById: paidBy.id,
			splitParticipants: {
				create: shares.map(([who, share]) => ({
					participantType: who.type,
					participantId: who.id,
					shareAmount: new Prisma.Decimal(share),
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

/** A payment from `from` to `to`, recorded by the payee. */
async function pay(
	from: Party,
	to: Party,
	amount: number,
	flags: {
		status: "FINALIZED" | "PROPOSED";
		byPayer: boolean;
		byPayee: boolean;
		auto: boolean;
	},
) {
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
			recordedByType: flags.byPayee ? to.type : from.type,
			recordedById: flags.byPayee ? to.id : from.id,
			status: flags.status,
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
			status: flags.status,
			confirmedByPayer: flags.byPayer,
			confirmedByPayee: flags.byPayee,
			autoConfirmedReason: flags.auto
				? "Recorded by the payee as a payment received"
				: null,
			settledAt: flags.status === "FINALIZED" ? new Date() : null,
			paymentGroupId: id,
		},
	});
	return id;
}

const fig = (
	changes: ReadonlyArray<{ id: string; delta: unknown }>,
	id: string,
) => changes.find((c) => c.id === id)?.delta;

describe("D12 deleting a split that payments covered (S17 on Postgres)", () => {
	let me: Awaited<ReturnType<typeof seedUser>>;
	let meP: Party;
	let paz: Party;
	let dup: string;

	beforeAll(async () => {
		me = await seedUser();
		await forUser(me.user.id).apply(setupEnvelopeBook, {
			...setupInput(me),
			timeZone: "UTC",
		});
		meP = { type: "user", id: me.user.id };
		paz = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: me.user.id, name: "Paz" },
				})
			).id,
		};
		// The same USD 20 rental entered twice, Paz's 10 of each paid separately.
		await split(
			meP,
			[
				[meP, 10],
				[paz, 10],
			],
			me.dining,
		);
		dup = (
			await split(
				meP,
				[
					[meP, 10],
					[paz, 10],
				],
				me.dining,
			)
		).id;
		for (let i = 0; i < 2; i++)
			await pay(paz, meP, 10, {
				status: "FINALIZED",
				byPayer: false,
				byPayee: true,
				auto: true,
			});
	});

	it("without a choice the delete is refused", async () => {
		await expect(
			forUser(me.user.id).apply(deleteSharedExpense, { id: dup }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("Keep the credit: you then owe Paz 10; Dining gets your 10 back; To assign unchanged", async () => {
		const p = await forUser(me.user.id).preview(deleteSharedExpense, {
			id: dup,
			settled: "KEEP_CREDIT",
		});
		expect(fig(p.changes, "owed.youOwe")).toEqual(usd(1_000));
		expect(fig(p.changes, "budget.leftToSpend")).toEqual(usd(1_000));
		expect(fig(p.changes, "budget.notPlannedYet")).toBeUndefined();
	});

	it("Void the payment: nobody owes anybody; the same budget change; preview writes nothing; apply voids one payment", async () => {
		const groups = () => adminDb.payment.count({ where: { payerId: paz.id } });
		const p = await forUser(me.user.id).preview(deleteSharedExpense, {
			id: dup,
			settled: "VOID_PAYMENT",
		});
		expect(fig(p.changes, "owed.youOwe")).toBeUndefined();
		expect(fig(p.changes, "budget.leftToSpend")).toEqual(usd(1_000));
		expect(fig(p.changes, "budget.notPlannedYet")).toBeUndefined();
		await expect(groups()).resolves.toBe(2);

		const before = await getMonth(me.user.id);
		await forUser(me.user.id).apply(deleteSharedExpense, {
			id: dup,
			settled: "VOID_PAYMENT",
		});
		await expect(groups()).resolves.toBe(1);
		const people = await computeBalance(
			adminDb,
			{ participantType: "user", participantId: me.user.id },
			{ participantType: "shadow", participantId: paz.id },
		);
		expect(people.byCurrency).toEqual({});
		expect((await getMonth(me.user.id))?.toAssign).toEqual(before?.toAssign);
	});

	it("a payment a real person confirmed cannot be voided this way: keep the credit instead", async () => {
		const { user: sam } = await createTestUser();
		const samP: Party = { type: "user", id: sam.id };
		await split(meP, [
			[meP, 5],
			[samP, 5],
		]);
		const second = await split(meP, [
			[meP, 5],
			[samP, 5],
		]);
		await pay(samP, meP, 5, {
			status: "FINALIZED",
			byPayer: true,
			byPayee: true,
			auto: false,
		});
		await pay(samP, meP, 5, {
			status: "FINALIZED",
			byPayer: true,
			byPayee: true,
			auto: false,
		});
		await expect(
			forUser(me.user.id).apply(deleteSharedExpense, {
				id: second.id,
				settled: "VOID_PAYMENT",
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});

describe("payment.confirm previews its budget change (R30)", () => {
	it("confirming Sam's 30 returns it to To assign: Not planned yet +30, held -30", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const { user: sam } = await createTestUser();
		const meP: Party = { type: "user", id: s.user.id };
		const samP: Party = { type: "user", id: sam.id };
		await split(
			meP,
			[
				[meP, 30],
				[samP, 30],
			],
			s.dining,
		);
		const paymentId = await pay(samP, meP, 30, {
			status: "PROPOSED",
			byPayer: true,
			byPayee: false,
			auto: false,
		});
		const p = await forUser(s.user.id).preview(confirmPayment, {
			paymentId,
			person: { participantType: "user", participantId: sam.id },
		});
		expect(fig(p.changes, "budget.notPlannedYet")).toEqual(usd(3_000));
		expect(fig(p.changes, "budget.heldForOthers")).toEqual(usd(-3_000));
	});
});

describe("open balances at the start (owner 2026-10-23)", () => {
	it("the setup preview lists what each person and you owe each other, per currency, never netted", async () => {
		const s = await seedUser();
		const meP: Party = { type: "user", id: s.user.id };
		const paz: Party = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: s.user.id, name: "Paz" },
				})
			).id,
		};
		// A dinner I paid 40 days ago (before this month, so before the budget starts).
		const t = await split(meP, [
			[meP, 10],
			[paz, 10],
		]);
		await adminDb.sharedTransaction.update({
			where: { id: t.id },
			data: { date: new Date(Date.now() - 40 * 86_400_000) },
		});
		const preview = await forUser(s.user.id).preview(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		expect(preview.value.openBalances).toEqual([
			{ participant: { type: "shadow", id: paz.id }, amount: usd(1_000) },
		]);
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);
	});
});

describe("forgive and routing details", () => {
	it("a forgive with no envelope (and no budget) is dated in the user's zone", async () => {
		const s = await seedUser();
		const meP: Party = { type: "user", id: s.user.id };
		const paz: Party = {
			type: "shadow",
			id: (
				await adminDb.shadowProfile.create({
					data: { createdById: s.user.id, name: "Paz" },
				})
			).id,
		};
		await split(meP, [
			[meP, 10],
			[paz, 10],
		]);
		const id = randomUUID();
		// 02:00 UTC on Oct 1 is still Sep 30 in Buenos Aires (the server's zone until users pick one).
		await userTransaction(adminDb, s.user.id, (tx) =>
			forgive(
				tx,
				s.user.id,
				{
					id,
					participant: paz,
					currency: "USD",
					amountMinor: 1_000,
					envelopeId: null,
				},
				new Date("2026-10-01T02:00:00Z"),
			),
		);
		const header = await adminDb.payment.findUniqueOrThrow({ where: { id } });
		expect(header.paidOn.toISOString().slice(0, 10)).toBe("2026-09-30");
	});

	it("the routing undo names your project_participant row", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const project = await adminDb.project.create({
			data: {
				name: "Trip",
				createdById: s.user.id,
				participants: {
					create: [
						{
							participantType: "user",
							participantId: s.user.id,
							role: "ORGANIZER",
						},
					],
				},
			},
			include: { participants: true },
		});
		const applied = await forUser(s.user.id).apply(setProjectRoutingMutation, {
			projectId: project.id,
			routing: "NOT_IN_BUDGET",
			envelopeId: null,
		});
		expect(applied.value.participantId).toBe(project.participants[0]?.id);
		expect(applied.undo).toEqual({
			kind: "revert",
			mutation: "envelope.setProjectRouting",
			rows: [{ table: "project_participant", id: project.participants[0]?.id }],
		});
	});
});
