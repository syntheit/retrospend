/**
 * The redesigned project pages' reads and money actions on Postgres, through
 * the real procedures and RLS. One shared project, every figure derived by
 * hand (ARS, two decimals, so minor = pesos x 100):
 *
 * | Expense   | Total   | Paid by | Split                          |
 * |-----------|---------|---------|--------------------------------|
 * | Rent      | 600,000 | Ana     | Ana 300,000, Ben 300,000       |
 * | Power     |  46,800 | Ben     | Ana 23,400, Ben 23,400         |
 * | Groceries |   9,000 | Ana     | Ana 3,000, Ben 3,000, Sam 3,000|
 *
 * Payment: Ben paid Ana 100,000 (final). Budget 1,000,000.
 *
 * | Person | Paid    | Share   | Received | Sent    | Balance  |
 * |--------|---------|---------|----------|---------|----------|
 * | Ana    | 609,000 | 326,400 | 100,000  | 0       |  182,600 |
 * | Ben    |  46,800 | 326,400 | 0        | 100,000 | -179,600 |
 * | Sam    |       0 |   3,000 | 0        | 0       |   -3,000 |
 *
 * Total 655,800; the balances add up to zero. Fewest transfers: Ben pays
 * Ana 179,600 and Sam pays Ana 3,000. Pairwise with Ana (balance.person):
 * Ben owes her 300,000 + 3,000 - 23,400 - 100,000 = 179,600, Sam 3,000.
 * Budget left 1,000,000 - 655,800 = 344,200, used 6,558 basis points.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	addMember,
	callerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const ars = (pesos: number) => ({ minor: pesos * 100, currency: "ARS" });

let ana: TestUser;
let ben: TestUser;
let pid: string;
let samKey: string;
let benKey: string;
let anaKey: string;

beforeAll(async () => {
	ana = await namedUser("Ana");
	ben = await namedUser("Ben");
	const sam = await adminDb.shadowProfile.create({
		data: { createdById: ana.user.id, name: "Sam" },
	});
	const project = await adminDb.project.create({
		data: {
			name: `Depto ${randomUUID().slice(0, 6)}`,
			primaryCurrency: "ARS",
			createdById: ana.user.id,
			budgetAmount: "1000000",
			budgetCurrency: "ARS",
		},
	});
	pid = project.id;
	await addMember(pid, "user", ana.user.id, "ORGANIZER");
	await addMember(pid, "user", ben.user.id, "EDITOR");
	await addMember(pid, "shadow", sam.id, "CONTRIBUTOR");
	const A = { type: "user" as const, id: ana.user.id };
	const B = { type: "user" as const, id: ben.user.id };
	const S = { type: "shadow" as const, id: sam.id };
	anaKey = `user:${ana.user.id}`;
	benKey = `user:${ben.user.id}`;
	samKey = `shadow:${sam.id}`;
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
		description: "Power",
		amount: "46800",
		currency: "ARS",
		date: "2026-10-05",
		paidBy: B,
		splits: [
			{ ...A, share: "23400" },
			{ ...B, share: "23400" },
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
	await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: ben.user.id,
			toParticipantType: "user",
			toParticipantId: ana.user.id,
			amount: "100000",
			currency: "ARS",
			status: "FINALIZED",
			projectId: pid,
		},
	});
});

describe("project.summary, recomputed by hand", () => {
	it("gives the total, what each person paid and owes, and the fewest transfers", async () => {
		const s = await callerFor(ana.user).summary({ projectId: pid });
		expect(s.total).toEqual([ars(655800)]);
		expect(s.balancesAddUp).toBe(true);
		const rows = Object.fromEntries(
			s.members.map((m) => [
				m.name,
				m.lines.map((l) => [
					l.paid.minor,
					l.share.minor,
					l.received.minor,
					l.sent.minor,
					l.balance.minor,
				]),
			]),
		);
		expect(rows).toEqual({
			Ana: [[60900000, 32640000, 10000000, 0, 18260000]],
			Ben: [[4680000, 32640000, 0, 10000000, -17960000]],
			Sam: [[0, 300000, 0, 0, -300000]],
		});
		expect(
			s.transfers.map((t) => [t.from.name, t.to.name, t.amount.minor]),
		).toEqual([
			["Ben", "Ana", 17960000],
			["Sam", "Ana", 300000],
		]);
	});
});

describe("project.pageView", () => {
	it("gives the hero, the budget and your balance with each person", async () => {
		const v = await callerFor(ana.user).pageView({ id: pid });
		expect(v.total).toEqual([ars(655800)]);
		expect(v.myShare).toEqual([ars(326400)]);
		expect(v.expenseCount).toBe(3);
		expect(v.budget).toEqual({
			amount: ars(1000000),
			spent: ars(655800),
			left: ars(344200),
			used: 6558,
			over: false,
		});
		const withMe = Object.fromEntries(v.members.map((m) => [m.id, m.withMe]));
		expect(withMe).toEqual({
			[anaKey]: [],
			[benKey]: [ars(179600)],
			[samKey]: [ars(3000)],
		});
		expect(v.members[0]?.isMe).toBe(true);
		expect(v.byCategory).toEqual([
			{
				id: null,
				name: null,
				icon: null,
				color: null,
				group: [ars(655800)],
				mine: [ars(326400)],
			},
		]);
		expect(
			v.payments.map((p) => [p.from.name, p.to.name, p.amount.minor]),
		).toEqual([["Ben", "Ana", 10000000]]);
		const groceries = v.expenses.find((e) => e.title === "Groceries");
		expect(groceries?.share).toEqual(ars(3000));
		expect(groceries?.payerIsMe).toBe(true);
	});

	it("is for members only", async () => {
		const olga = await namedUser("Olga");
		await expect(callerFor(olga.user).pageView({ id: pid })).rejects.toThrow();
	});
});

describe("project.listView", () => {
	it("lists the project with the same figures as the page", async () => {
		const list = await callerFor(ben.user).listView();
		const row = list.find((p) => p.id === pid);
		expect(row?.total).toEqual([ars(655800)]);
		expect(row?.myShare).toEqual([ars(326400)]);
		expect(row?.myBalance).toEqual([ars(-179600)]);
		expect(row?.people.map((p) => p.name).sort()).toEqual(["Ana", "Sam"]);
		expect(row?.solo).toBe(false);
		expect(row?.firstExpense).toBe("2026-10-01");
	});
});

describe("membership dates preview (R30)", () => {
	it("moves no balance, and the preview writes nothing", async () => {
		const input = {
			projectId: pid,
			participantType: "user" as const,
			participantId: ben.user.id,
			leftOn: "2026-10-20",
		};
		const p = await callerFor(ana.user).membershipDatesPreview(input);
		expect(p.changes).toEqual([]);
		expect(p.unchanged.map((u) => u.id).sort()).toEqual([
			"project.member.balance",
			"project.total",
		]);
		const row = await adminDb.projectParticipant.findFirstOrThrow({
			where: { projectId: pid, participantId: ben.user.id },
		});
		expect(row.leftOn).toBeNull();
	});
});

describe("Settle all (R30, R15)", () => {
	it("previews, records every line, and Undo takes the payments back", async () => {
		const caller = callerFor(ana.user);
		const preview = await caller.settleAllPreview({ projectId: pid });
		expect(
			preview.value.lines.map((l) => [l.person, l.direction, l.amount.minor]),
		).toEqual([
			[benKey, "incoming", 17960000],
			[samKey, "incoming", 300000],
		]);
		expect(preview.unchanged.map((u) => u.id)).toContain("project.total");
		expect(
			await adminDb.payment.count({ where: { payeeId: ana.user.id } }),
		).toBe(0);

		const applied = await caller.settleAll({ projectId: pid });
		const after = await caller.summary({ projectId: pid });
		expect(after.transfers).toEqual([]);
		expect(after.total).toEqual([ars(655800)]);

		await caller.settleAllUndo({
			projectId: pid,
			paymentIds: applied.value.lines.map((l) => l.paymentId),
		});
		const back = await caller.summary({ projectId: pid });
		expect(back.transfers.map((t) => t.amount.minor)).toEqual([
			17960000, 300000,
		]);
	});
});
