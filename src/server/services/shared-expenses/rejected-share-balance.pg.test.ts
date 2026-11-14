/**
 * A rejected share is not owed, so no balance counts it (the one rule:
 * COUNTED_SHARE in balance.ts, shareCounts in the domain package). On real
 * Postgres, through userTransaction and RLS. ARS is two decimals, so minor =
 * pesos x 100; USD cents likewise. Rates: ARS blue 1,500 per USD, the type
 * Bruno's ARS default names, so ARS 30,000 is USD 20.00 for him.
 *
 * Scenario A (no project). Ana (home ARS) paid ARS 90,000, split three ways at
 * 30,000: Ana and Caro accepted, Bruno (home USD) REJECTED. Dario paid USD 60,
 * split 30 and 30: Dario accepted, Ana's USD 30 REJECTED.
 *   Ana-Bruno: 0 both ways.  Ana-Caro: Caro owes Ana ARS 30,000.
 *   Ana-Dario: 0 both ways (her USD 30 is not owed).
 *   Ana: Owed to you ARS 30,000, You owe 0 (the USD 30 would be ARS 45,000).
 *   Bruno: nothing owed either way (the ARS 30,000 would be USD 20.00).
 *
 * Scenario B (a project, Ana paid 90,000, same shares): the payer absorbs what
 * no counted share covers, as Remove me does (ledger-posting.ts).
 *   Ana   paid 90,000, share 30,000 + 30,000 = 60,000, balance +30,000
 *   Bruno no lines
 *   Caro  share 30,000, balance -30,000;  one transfer Caro to Ana 30,000.
 *   Ana's category line "mine" is 60,000 (equals her share), Bruno's is none.
 *
 * Scenario C (paid, then rejected): Ana paid 60,000 (Ana 30,000, Bruno 30,000
 * REJECTED) and Bruno had paid Ana ARS 30,000 (final). His debt is gone and
 * the payment stays: Ana owes Bruno 30,000 (a reversed debt, which is why a
 * locked expense cannot be rejected).
 *
 * Scenario D (removal readers): Ana paid 40,000 (Ana 20,000, Bruno 20,000
 * REJECTED), Bruno paid Ana 20,000. Nothing is in the balance for his share,
 * so deleting it or removing himself flips nothing.
 *
 * Scenario E (the budget): the payer's envelope keeps the rejected share
 * fronted (the cash left, decision Q3): Ana paid USD 90, Bruno's 30 REJECTED,
 * Caro's 30 accepted and unpaid. People owes her 30; the budget holds 60.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { readFigures } from "~/server/figures/read";
import { readShareSnapshot } from "~/server/services/sync/snapshots";
import { dayKey } from "@retrospend/domain/time-zone";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { computeBalance } from "./balance";
import { computePeriodSettleStatus } from "./billing-period-settle";
import { lockSettledSplits } from "../corrections/locks";
import { guardDelete } from "./delete-guard";
import { removeSelfIn } from "./remove-self";
import { owedRead } from "../payments/figures";
import { settleContext } from "../people/settle-context";
import { projectSettlementPlan } from "../project/group.service";
import { listProjects } from "../project/project-read.service";
import {
	addMember,
	callerFor,
	namedUser,
	seedExpense,
	type TestUser,
} from "../project/__tests__/trip-fixture";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { forUser } from "../preview";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import { FigureUnavailable } from "~/server/figures/registry";
import type { ParticipantRef } from "./types";

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const ars = (pesos: number) => ({ minor: pesos * 100, currency: "ARS" });

async function seedRate() {
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: today, currency: "ARS", type: "blue" },
		},
		create: { date: today, currency: "ARS", type: "blue", rate: "1500" },
		update: { rate: "1500" },
	});
}

/** Ana (home ARS), Bruno (home USD, ARS at blue), Caro (ARS), Dario (USD). */
async function cast() {
	const people = {
		ana: await namedUser("Ana"),
		bruno: await namedUser("Bruno"),
		caro: await namedUser("Caro"),
		dario: await namedUser("Dario"),
	};
	for (const [u, home] of [
		[people.ana, "ARS"],
		[people.bruno, "USD"],
		[people.caro, "ARS"],
		[people.dario, "USD"],
	] as const) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: {
				homeCurrency: home,
				defaultRateTypes: home === "USD" ? { ARS: "blue" } : {},
			},
		});
	}
	return people;
}

const who = (u: TestUser) => ({ type: "user" as const, id: u.user.id });

const balance = (as: TestUser, a: TestUser, b: TestUser) =>
	userTransaction(adminDb, as.user.id, (tx) =>
		computeBalance(tx, ref(a), ref(b), { viewer: ref(as) }),
	).then((r) => r.minorByCurrency);

const owedOf = async (u: TestUser) => {
	const owed = await userTransaction(adminDb, u.user.id, (tx) =>
		owedRead(tx, u.user.id),
	);
	if (owed instanceof FigureUnavailable) throw new Error("unpriced");
	return owed;
};

beforeAll(seedRate);

describe("scenario A: a rejected share is in no pair balance or total", () => {
	let t: Awaited<ReturnType<typeof cast>>;

	beforeAll(async () => {
		t = await cast();
		const { ana, bruno, caro, dario } = t;
		// seedExpense wants a project id; these two expenses have none.
		for (const e of [
			{
				amount: "90000",
				currency: "ARS",
				payer: ana,
				shares: [
					[ana, "30000", "ACCEPTED"],
					[bruno, "30000", "REJECTED"],
					[caro, "30000", "ACCEPTED"],
				],
			},
			{
				amount: "60",
				currency: "USD",
				payer: dario,
				shares: [
					[dario, "30", "ACCEPTED"],
					[ana, "30", "REJECTED"],
				],
			},
		] as const) {
			await adminDb.sharedTransaction.create({
				data: {
					description: "Shared",
					amount: e.amount,
					currency: e.currency,
					date: new Date("2026-10-08"),
					paidByType: "user",
					paidById: e.payer.user.id,
					createdByType: "user",
					createdById: e.payer.user.id,
					splitParticipants: {
						create: e.shares.map(([u, share, status]) => ({
							participantType: "user" as const,
							participantId: u.user.id,
							shareAmount: share,
							verificationStatus: status,
						})),
					},
				},
			});
		}
	});

	it("1: Ana and Bruno are even both ways, Caro owes Ana 30,000, Dario and Ana are even", async () => {
		const { ana, bruno, caro, dario } = t;
		// Catches the two loads in balance.ts: Ana paid and Bruno owes, and
		// Dario paid and Ana owes (the mirror).
		expect(await balance(ana, ana, bruno)).toEqual({});
		expect(await balance(bruno, bruno, ana)).toEqual({});
		expect(await balance(ana, ana, caro)).toEqual({ ARS: 3_000_000 });
		expect(await balance(caro, caro, ana)).toEqual({ ARS: -3_000_000 });
		expect(await balance(ana, ana, dario)).toEqual({});
		expect(await balance(dario, dario, ana)).toEqual({});
	});

	it("2: Owed to you is ARS 30,000 and You owe 0 for Ana, and nothing for Bruno", async () => {
		const { ana, bruno } = t;
		// Catches both loads in balance-batch.ts: Ana as payer (Bruno) and
		// Ana as participant (Dario, whose USD 30 would be ARS 45,000).
		expect(await owedOf(ana)).toMatchObject({
			owedToYou: 3_000_000,
			youOwe: 0,
			currency: "ARS",
		});
		expect(await owedOf(bruno)).toMatchObject({ owedToYou: 0, youOwe: 0 });
	});

	it("6: the synced share snapshot's owed equals owedRead", async () => {
		const { ana } = t;
		const snapshot = await readShareSnapshot(adminDb, ana.user.id);
		expect(snapshot.owed).toEqual(await owedOf(ana));
	});
});

describe("scenario B: a project's summary charges a rejected share to the payer", () => {
	it("3: Ana is +30,000, Bruno has no lines, Caro pays Ana 30,000, balances add up", async () => {
		const { ana, bruno, caro } = await cast();
		const project = await adminDb.project.create({
			data: {
				name: "Asado",
				primaryCurrency: "ARS",
				createdById: ana.user.id,
			},
		});
		await addMember(project.id, "user", ana.user.id, "ORGANIZER");
		await addMember(project.id, "user", bruno.user.id, "CONTRIBUTOR");
		await addMember(project.id, "user", caro.user.id, "CONTRIBUTOR");
		await seedExpense(project.id, {
			description: "Asado",
			amount: "90000",
			currency: "ARS",
			date: "2026-10-08",
			paidBy: who(ana),
			splits: [
				{ ...who(ana), share: "30000" },
				{ ...who(bruno), share: "30000", status: "REJECTED" },
				{ ...who(caro), share: "30000" },
			],
		});

		const s = await callerFor(ana.user).summary({ projectId: project.id });
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
		// Catches project/ledger.ts (the nested load) and the payer's gap in
		// ledger-posting.ts: Ana 9,000,000 - (3,000,000 + 3,000,000 absorbed).
		expect(rows).toEqual({
			Ana: [[9_000_000, 6_000_000, 0, 0, 3_000_000]],
			Bruno: [],
			Caro: [[0, 3_000_000, 0, 0, -3_000_000]],
		});
		expect(s.balancesAddUp).toBe(true);
		expect(
			s.transfers.map((x) => [x.from.name, x.to.name, x.amount.minor]),
		).toEqual([["Caro", "Ana", 3_000_000]]);

		// The page: Ana's category line equals her share, Bruno's has none.
		const anaPage = await callerFor(ana.user).pageView({ id: project.id });
		expect(anaPage.myShare).toEqual([ars(60_000)]);
		expect(anaPage.byCategory[0]?.mine).toEqual([ars(60_000)]);
		const brunoPage = await callerFor(bruno.user).pageView({
			id: project.id,
		});
		expect(brunoPage.myShare).toEqual([]);
		expect(brunoPage.byCategory[0]?.mine).toEqual([]);

		// Not settled until Caro pays: settledByProject and the period check
		// read the same rule (Bruno owes nothing, so one payment settles it).
		const settledOf = async () =>
			(await listProjects(ana.db as never, ana.user.id)).find(
				(p) => p.id === project.id,
			)?.isSettled;
		expect(await settledOf()).toBe(false);
		const period = await adminDb.billingPeriod.create({
			data: {
				projectId: project.id,
				label: "October",
				startDate: new Date("2026-10-01T00:00:00Z"),
				endDate: new Date("2026-10-31T00:00:00Z"),
			},
		});
		const before = await computePeriodSettleStatus(adminDb, period);
		expect(
			before.outstanding
				.map((o) => [o.participant.participantId, o.amount])
				.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
		).toEqual(
			[
				[ana.user.id, 30_000],
				[caro.user.id, -30_000],
			].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
		);
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: caro.user.id,
				toParticipantType: "user",
				toParticipantId: ana.user.id,
				amount: "30000",
				currency: "ARS",
				status: "FINALIZED",
				projectId: project.id,
			},
		});
		expect(await settledOf()).toBe(true);
		expect((await computePeriodSettleStatus(adminDb, period)).outstanding).toEqual(
			[],
		);
		const plan = await projectSettlementPlan(adminDb, project.id);
		expect(plan.byCurrency.ARS?.plan ?? []).toEqual([]);
	});
});

describe("scenario C: a payment, then a rejection", () => {
	it("4: Ana owes Bruno 30,000, Bruno is owed USD 20.00, and the settle quote says you owe 30,000", async () => {
		const { ana, bruno } = await cast();
		await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "60000",
				currency: "ARS",
				date: new Date("2026-10-08"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: ana.user.id,
							shareAmount: "30000",
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: bruno.user.id,
							shareAmount: "30000",
							verificationStatus: "REJECTED",
						},
					],
				},
			},
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: bruno.user.id,
				toParticipantType: "user",
				toParticipantId: ana.user.id,
				amount: "30000",
				currency: "ARS",
				status: "FINALIZED",
			},
		});
		expect(await balance(ana, ana, bruno)).toEqual({ ARS: -3_000_000 });
		expect(await balance(bruno, bruno, ana)).toEqual({ ARS: 3_000_000 });
		// ARS 30,000 at blue 1,500 per USD is USD 20.00.
		expect(await owedOf(bruno)).toMatchObject({
			owedToYou: 2_000,
			youOwe: 0,
			currency: "USD",
		});
		expect(await owedOf(ana)).toMatchObject({
			owedToYou: 0,
			youOwe: 3_000_000,
			currency: "ARS",
		});
		const quote = await userTransaction(adminDb, ana.user.id, (tx) =>
			settleContext(tx, ana.user.id, { person: ref(bruno) }),
		);
		expect(quote.direction).toBe("outgoing");
		expect(quote.everything).toEqual(ars(30_000));
	});
});

describe("scenario D: removing a rejected share flips nothing", () => {
	it("7: delete is not flipped, VOID_PAYMENT leaves Bruno's payment, Remove me needs no confirmation", async () => {
		const { ana, bruno } = await cast();
		const expense = await adminDb.sharedTransaction.create({
			data: {
				description: "Cena",
				amount: "40000",
				currency: "ARS",
				date: new Date("2026-10-08"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: ana.user.id,
							shareAmount: "20000",
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: bruno.user.id,
							shareAmount: "20000",
							verificationStatus: "REJECTED",
						},
					],
				},
			},
			include: { splitParticipants: true },
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: bruno.user.id,
				toParticipantType: "user",
				toParticipantId: ana.user.id,
				amount: "20000",
				currency: "ARS",
				status: "FINALIZED",
			},
		});
		// Catches delete-guard.ts (it asked to confirm: the payment would
		// become a debt the other way round) and void-covering.ts (it voided
		// Bruno's payment for a share nobody owed).
		await userTransaction(adminDb, ana.user.id, (tx) =>
			guardDelete(tx, expense, ref(ana), false),
		);
		await userTransaction(adminDb, ana.user.id, (tx) =>
			guardDelete(tx, expense, ref(ana), { settled: "VOID_PAYMENT" }),
		);
		expect(
			await adminDb.settlement.count({
				where: { fromParticipantId: bruno.user.id },
			}),
		).toBe(1);
		// Catches remove-self.ts (it demanded confirmBalanceChange).
		const removed = await userTransaction(adminDb, bruno.user.id, (tx) =>
			removeSelfIn(tx, ref(bruno), expense.id),
		);
		expect(removed.removed).toHaveLength(1);
	});
});

describe("scenario F: a payment locks the expenses it settled, not a rejected share", () => {
	it("a payment that clears Bruno's counted debt locks that expense and leaves the one he rejected", async () => {
		const { ana, bruno } = await cast();
		const expense = (description: string, status: "ACCEPTED" | "REJECTED") =>
			adminDb.sharedTransaction.create({
				data: {
					description,
					amount: "40000",
					currency: "ARS",
					date: new Date("2026-10-08"),
					paidByType: "user",
					paidById: ana.user.id,
					createdByType: "user",
					createdById: ana.user.id,
					splitParticipants: {
						create: [
							{
								participantType: "user",
								participantId: ana.user.id,
								shareAmount: "20000",
								verificationStatus: "ACCEPTED",
							},
							{
								participantType: "user",
								participantId: bruno.user.id,
								shareAmount: "20000",
								verificationStatus: status,
							},
						],
					},
				},
			});
		const counted = await expense("Counted", "ACCEPTED");
		const rejected = await expense("Rejected", "REJECTED");
		// Bruno owes 20,000 (the counted one); he pays exactly that.
		const header = await adminDb.payment.create({
			data: {
				id: randomUUID(),
				payerType: "user",
				payerId: bruno.user.id,
				payeeType: "user",
				payeeId: ana.user.id,
				amount: "20000",
				currency: "ARS",
				paidOn: today,
				recordedByType: "user",
				recordedById: ana.user.id,
				status: "FINALIZED",
			},
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: bruno.user.id,
				toParticipantType: "user",
				toParticipantId: ana.user.id,
				amount: "20000",
				currency: "ARS",
				status: "FINALIZED",
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date(),
				paymentGroupId: header.id,
			},
		});
		// Catches corrections/locks.ts: the rejected expense would lock too.
		const locked = await userTransaction(adminDb, ana.user.id, (tx) =>
			lockSettledSplits(tx, ref(ana), header.id),
		);
		expect(locked).toBe(1);
		const flags = await adminDb.sharedTransaction.findMany({
			where: { id: { in: [counted.id, rejected.id] } },
			select: { id: true, isLocked: true },
		});
		expect(Object.fromEntries(flags.map((f) => [f.id, f.isLocked]))).toEqual({
			[counted.id]: true,
			[rejected.id]: false,
		});
	});
});

describe("scenario E: the payer's budget keeps the rejected share fronted", () => {
	it("9: People owes Ana 30, her budget holds 60", async () => {
		const me = await seedUser();
		const bruno = (await createTestUser()).user;
		const caro = (
			await adminDb.shadowProfile.create({
				data: { createdById: me.user.id, name: "Caro" },
			})
		).id;
		await forUser(me.user.id).apply(setupEnvelopeBook, {
			...setupInput(me),
			timeZone: "UTC",
		});
		await adminDb.sharedTransaction.create({
			data: {
				description: "Asado",
				amount: "90",
				currency: "USD",
				date: new Date(),
				categoryId: me.dining,
				paidByType: "user",
				paidById: me.user.id,
				createdByType: "user",
				createdById: me.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: me.user.id,
							shareAmount: "30",
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: bruno.id,
							shareAmount: "30",
							verificationStatus: "REJECTED",
						},
						{
							participantType: "shadow",
							participantId: caro,
							shareAmount: "30",
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
		const read = await readFigures(me.user.id, [
			"owed.owedToYou",
			"budget.heldForOthers",
		]);
		expect(read.get("owed.owedToYou")).toEqual([
			{ minor: 3_000, currency: "USD" },
		]);
		expect(read.get("budget.heldForOthers")).toEqual([
			{ minor: 6_000, currency: "USD" },
		]);
	});
});
