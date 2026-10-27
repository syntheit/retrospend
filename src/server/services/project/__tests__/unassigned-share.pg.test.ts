/**
 * "Remove me" leaves part of an expense unassigned: the payer absorbs it, so
 * a project's balances still add up to zero in every currency. Real data hit
 * this: USD 67.67 split three ways (22.56, 22.56, 22.55) lost one person's
 * 22.56, and every group view warned that USD balances summed to 22.56.
 *
 * | Expense | Total     | Paid by | Split at save              | After Ben leaves |
 * |---------|-----------|---------|----------------------------|------------------|
 * | Statue  | USD 67.67 | Ana     | Ana 22.56, Ben 22.56, Cam 22.55 | Ana, Cam    |
 * | Tools   | USD 20    | Ana     | Cam 20 (exact)             |                  |
 *
 * Ana: paid 8767, share 2256 + 2256 (unassigned) = 4512, balance 4255.
 * Cam: share 2255 + 2000 = 4255, balance -4255.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { forUser } from "~/server/services/preview";
import { removeSelfMutation } from "~/server/services/shared-expenses/remove-self.mutation";
import { adminDb } from "~/test/pg-harness";
import { projectSettlementPlan } from "../group.service";
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
let cam: TestUser;
let projectId: string;

beforeAll(async () => {
	ana = await namedUser("Ana");
	ben = await namedUser("Ben");
	cam = await namedUser("Cam");
	const project = await adminDb.project.create({
		data: {
			name: `Statue ${randomUUID().slice(0, 6)}`,
			primaryCurrency: "USD",
			createdById: ana.user.id,
		},
	});
	projectId = project.id;
	await addMember(projectId, "user", ana.user.id, "ORGANIZER");
	await addMember(projectId, "user", ben.user.id, "EDITOR");
	await addMember(projectId, "user", cam.user.id, "EDITOR");
	const A = { type: "user" as const, id: ana.user.id };
	const B = { type: "user" as const, id: ben.user.id };
	const C = { type: "user" as const, id: cam.user.id };
	const statue = await seedExpense(projectId, {
		description: "Statue",
		amount: "67.67",
		currency: "USD",
		date: "2026-10-16",
		paidBy: A,
		splits: [
			{ ...A, share: "22.56" },
			{ ...B, share: "22.56" },
			{ ...C, share: "22.55" },
		],
	});
	await seedExpense(projectId, {
		description: "Tools",
		amount: "20",
		currency: "USD",
		date: "2026-10-16",
		paidBy: A,
		splitMode: "EXACT",
		splits: [
			{ ...A, share: "0" },
			{ ...C, share: "20" },
		],
	});
	await forUser(ben.user.id).apply(removeSelfMutation, {
		transactionId: statue.id,
		confirmBalanceChange: true,
	});
});

describe("an expense with a removed share", () => {
	it("the settlement plan charges the gap to the payer and adds up", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plan = await projectSettlementPlan(adminDb, projectId);
		const balances = plan.byCurrency.USD!.balances;
		const net = (id: string) =>
			balances.find((b) => b.participant.participantId === id)?.netBalance;
		expect(net(ana.user.id)).toBe(42.55);
		expect(net(cam.user.id)).toBe(-42.55);
		expect(plan.byCurrency.USD!.plan).toMatchObject([
			{ amount: 42.55, currency: "USD" },
		]);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("the summary says the balances add up", async () => {
		const s = await callerFor(ana.user).summary({ projectId });
		expect(s.balancesAddUp).toBe(true);
		const lines = Object.fromEntries(
			s.members.map((m) => [m.name, m.lines.map((l) => l.balance.minor)]),
		);
		expect(lines.Ana).toEqual([4255]);
		expect(lines.Cam).toEqual([-4255]);
	});
});
