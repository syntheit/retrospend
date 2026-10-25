/**
 * The tRPC path (SettlementService) and the v1 path (the reversal mutations
 * run through the preview runner) are one implementation: the same payment
 * taken back, voided or rejected by each leaves the same rows, the same
 * header and the same audit entry. Each case sets up two identical pairs.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	ref,
	seedProject,
	seedRates,
	seedShare,
	type TestUser,
} from "~/server/api/v1/__tests__/g3-fixtures";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import { adminDb } from "~/test/pg-harness";
import { applyPayment } from "./procedures";
import {
	paymentPerson,
	rejectPayment,
	removeRecordedPayment,
} from "./reverse.mutation";

type Pair = { payer: TestUser; payee: TestUser };

async function pair(): Promise<Pair> {
	const [payer, payee] = [await arsUser(), await arsUser()];
	await seedProject(payer, [{ user: payee, role: "EDITOR" }]);
	await seedShare(ref(payee), ref(payer), "1000", "ARS");
	return { payer, payee };
}

/** The payer's pending payment of ARS 400 to the payee; returns its id. */
async function pending({ payer, payee }: Pair) {
	const { value } = await applyPayment(payer.db, payer.user.id, {
		person: ref(payee),
		direction: "outgoing",
		currency: "ARS",
		amount: "400",
	});
	if (!value.recorded) throw new Error("not recorded");
	return value.paymentId;
}

/** What is left of a payment and what was logged about its lead row. */
async function aftermath(paymentId: string) {
	const header = await adminDb.payment.findUnique({ where: { id: paymentId } });
	const rows = await adminDb.settlement.findMany({
		where: { paymentGroupId: paymentId },
		select: { status: true, rejectedReason: true },
	});
	return { header: header?.status ?? null, rows };
}

/** The audit entries about one settlement row, as action and context. */
async function logged(rowId: string) {
	const entries = await adminDb.auditLogEntry.findMany({
		where: { targetId: rowId },
		orderBy: { timestamp: "asc" },
	});
	return entries.map((e) => [e.action, e.context]);
}

async function leadRow(paymentId: string) {
	const row = await adminDb.settlement.findFirstOrThrow({
		where: { paymentGroupId: paymentId },
		orderBy: { initiatedAt: "asc" },
	});
	return row.id;
}

async function viaV1(
	user: TestUser,
	paymentId: string,
	run: "remove" | "reject",
	reason?: string,
) {
	const person = await paymentPerson(user.db, paymentId, user.user.id);
	if (!person) throw new Error("not on the payment");
	const input = { paymentId, person };
	if (run === "remove")
		await forUser(user.user.id).apply(removeRecordedPayment, input);
	else await forUser(user.user.id).apply(rejectPayment, { ...input, reason });
}

describe("payment reversals: one implementation for tRPC and v1", () => {
	beforeAll(seedRates);

	it("deletes a pending payment the same way", async () => {
		const [a, b] = [await pair(), await pair()];
		const [idA, idB] = [await pending(a), await pending(b)];
		const [rowA, rowB] = [await leadRow(idA), await leadRow(idB)];
		await new SettlementService(
			a.payer.db,
			a.payer.user.id,
		).deletePendingSettlement(rowA);
		await viaV1(b.payer, idB, "remove");
		expect(await aftermath(idA)).toEqual({ header: null, rows: [] });
		expect(await aftermath(idB)).toEqual({ header: null, rows: [] });
		const [logA, logB] = [await logged(rowA), await logged(rowB)];
		expect(logA.map((e) => e[0])).toContain("DELETED");
		expect(logB).toEqual(logA);
	});

	it("rejects a pending payment the same way", async () => {
		const [a, b] = [await pair(), await pair()];
		const [idA, idB] = [await pending(a), await pending(b)];
		const [rowA, rowB] = [await leadRow(idA), await leadRow(idB)];
		await new SettlementService(a.payee.db, a.payee.user.id).rejectSettlement(
			rowA,
			"never came",
		);
		await viaV1(b.payee, idB, "reject", "never came");
		const rejected = {
			header: "REJECTED",
			rows: [{ status: "REJECTED", rejectedReason: "never came" }],
		};
		expect(await aftermath(idA)).toEqual(rejected);
		expect(await aftermath(idB)).toEqual(rejected);
		const [logA, logB] = [await logged(rowA), await logged(rowB)];
		expect(logA.map((e) => e[0])).toContain("REJECTED");
		expect(logB).toEqual(logA);
	});

	it("keeps the typed reason out of the audit JSON and the notice", async () => {
		const a = await pair();
		const id = await pending(a);
		const row = await leadRow(id);
		const reason = "secret words nobody else should read";
		await new SettlementService(a.payee.db, a.payee.user.id).rejectSettlement(
			row,
			reason,
		);
		// It is kept in its own column ...
		await expect(
			adminDb.settlement.findUnique({ where: { id: row } }),
		).resolves.toMatchObject({ rejectedReason: reason });
		// ... and in neither the audit JSON ...
		const entries = await adminDb.auditLogEntry.findMany({
			where: { targetId: row },
		});
		expect(JSON.stringify(entries)).not.toContain(reason);
		// ... nor the notice the payer gets, which is built from the name and amount.
		const notice = await vi.waitFor(async () => {
			const found = await adminDb.notification.findFirst({
				where: { userId: a.payer.user.id, type: "SETTLEMENT_REJECTED" },
			});
			if (!found) throw new Error("no notice yet");
			return found;
		});
		expect(JSON.stringify(notice)).not.toContain(reason);
	});

	it("refuses the same people the same way", async () => {
		const a = await pair();
		const id = await pending(a);
		const row = await leadRow(id);
		// The payee cannot delete; the payer cannot reject. Both paths say 403.
		await expect(
			new SettlementService(
				a.payee.db,
				a.payee.user.id,
			).deletePendingSettlement(row),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(viaV1(a.payee, id, "remove")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			new SettlementService(a.payer.db, a.payer.user.id).rejectSettlement(row),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(viaV1(a.payer, id, "reject")).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			adminDb.payment.findUnique({ where: { id } }),
		).resolves.toMatchObject({
			status: "PROPOSED",
		});
	});
});
