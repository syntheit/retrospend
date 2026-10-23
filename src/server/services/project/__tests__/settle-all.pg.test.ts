/**
 * Settle all on Postgres, the edges: the balances move between preview and
 * Record, Undo when one payment can no longer be undone, and a line the
 * other person already says they paid. Each test seeds its own project.
 *
 * Base project (ARS): Rent 600,000 paid by Ana, split Ana and Ben 300,000
 * each; Groceries 9,000 paid by Ana, split Ana, Ben and Sam 3,000 each. So
 * Ben owes Ana 303,000 and Sam 3,000 (minor = pesos x 100).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { recordPayment } from "~/server/services/payments/record.mutation";
import { forUser } from "~/server/services/preview";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";
import { adminDb } from "~/test/pg-harness";
import {
	addMember,
	callerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

let ana: TestUser;
let ben: TestUser;

beforeAll(async () => {
	ana = await namedUser("Ana");
	ben = await namedUser("Ben");
});

async function seedProject() {
	const sam = await adminDb.shadowProfile.create({
		data: { createdById: ana.user.id, name: "Sam" },
	});
	const project = await adminDb.project.create({
		data: {
			name: `Depto ${randomUUID().slice(0, 6)}`,
			primaryCurrency: "ARS",
			createdById: ana.user.id,
		},
	});
	const pid = project.id;
	await addMember(pid, "user", ana.user.id, "ORGANIZER");
	await addMember(pid, "user", ben.user.id, "EDITOR");
	await addMember(pid, "shadow", sam.id, "CONTRIBUTOR");
	const A = { type: "user" as const, id: ana.user.id };
	const B = { type: "user" as const, id: ben.user.id };
	const S = { type: "shadow" as const, id: sam.id };
	await seedExpense(pid, {
		description: "Rent",
		amount: "600000",
		currency: "ARS",
		date: "2026-10-01",
		paidBy: A,
		splits: [
			{ ...A, share: "300000" },
			{ ...B, share: "300000" },
		],
	});
	await seedExpense(pid, {
		description: "Groceries",
		amount: "9000",
		currency: "ARS",
		date: "2026-10-09",
		paidBy: A,
		splits: [
			{ ...A, share: "3000" },
			{ ...B, share: "3000" },
			{ ...S, share: "3000" },
		],
	});
	return { pid, A, B, S, benKey: `user:${ben.user.id}`, samKey: `shadow:${sam.id}` };
}

const paymentsIn = (projectId: string) =>
	adminDb.settlement.count({ where: { projectId } });

describe("Settle all: Record checks what the preview showed", () => {
	it("refuses with CONFLICT when an expense was added after the preview", async () => {
		const { pid, A, B } = await seedProject();
		const caller = callerFor(ana.user);
		const preview = await caller.settleAllPreview({ projectId: pid });
		expect(preview.value.planned).toHaveLength(2);
		await seedExpense(pid, {
			description: "Taxi",
			amount: "120000",
			currency: "ARS",
			date: "2026-10-10",
			paidBy: A,
			splits: [
				{ ...A, share: "60000" },
				{ ...B, share: "60000" },
			],
		});
		await expect(
			caller.settleAll({ projectId: pid, expect: [...preview.value.planned] }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await paymentsIn(pid)).toBe(0);

		const again = await caller.settleAllPreview({ projectId: pid });
		const done = await caller.settleAll({
			projectId: pid,
			expect: [...again.value.planned],
		});
		expect(done.value.lines.map((l) => l.amount.minor).sort()).toEqual([
			300000, 36300000,
		]);
	});
});

describe("Settle all: Undo is all or none, in this project only", () => {
	it("undoes nothing when one payment was confirmed meanwhile", async () => {
		const { pid, A, B } = await seedProject();
		// Ana owes Ben USD 50, so Settle all pays him (pending until he confirms).
		await seedExpense(pid, {
			description: "Boat",
			amount: "100",
			currency: "USD",
			date: "2026-10-11",
			paidBy: B,
			splits: [
				{ ...A, share: "50" },
				{ ...B, share: "50" },
			],
		});
		const caller = callerFor(ana.user);
		const preview = await caller.settleAllPreview({ projectId: pid });
		const done = await caller.settleAll({
			projectId: pid,
			expect: [...preview.value.planned],
		});
		const usd = done.value.lines.find((l) => l.amount.currency === "USD");
		expect(usd?.direction).toBe("outgoing");
		const row = await adminDb.settlement.findFirstOrThrow({
			where: { paymentGroupId: usd?.paymentId },
		});
		await new SettlementService(adminDb, ben.user.id).confirmSettlement(row.id);
		const before = await paymentsIn(pid);

		await expect(
			caller.settleAllUndo({
				projectId: pid,
				paymentIds: done.value.lines.map((l) => l.paymentId),
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await paymentsIn(pid)).toBe(before);
	});

	it("refuses an id that is not a payment of this project", async () => {
		const { pid } = await seedProject();
		const other = await seedProject();
		const caller = callerFor(ana.user);
		const preview = await caller.settleAllPreview({ projectId: other.pid });
		const done = await caller.settleAll({
			projectId: other.pid,
			expect: [...preview.value.planned],
		});
		await expect(
			caller.settleAllUndo({ projectId: pid, paymentIds: ["bogus"] }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			caller.settleAllUndo({
				projectId: pid,
				paymentIds: done.value.lines.map((l) => l.paymentId),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await paymentsIn(other.pid)).toBe(2);
	});
});

describe("Settle all: a line the other person already says they paid", () => {
	it("is skipped with its reason and the other lines still record", async () => {
		const { pid, benKey, samKey } = await seedProject();
		await forUser(ben.user.id).apply(recordPayment, {
			person: { participantType: "user", participantId: ana.user.id },
			direction: "outgoing",
			currency: "ARS",
			amount: "303000",
			applyTo: [{ scope: pid, currency: "ARS" }],
		});
		const caller = callerFor(ana.user);
		const preview = await caller.settleAllPreview({ projectId: pid });
		expect(preview.value.lines.map((l) => l.person)).toEqual([samKey]);
		expect(
			preview.value.skipped.map((l) => [l.person, l.reason, l.amount.minor]),
		).toEqual([[benKey, "matches_claim", 30300000]]);
	});
});
