/**
 * A small book for the export documents on a real Postgres. Every amount is
 * chosen so the expected cells can be derived by hand (see export-golden).
 *
 * Project "Cordoba" (ARS home): Ana (organizer), Ben, Cam, and Sam, a person
 * Ana added who is not on Retrospend. All in the "Oct 2026" billing period.
 *
 * | Expense | Total          | Paid by | Split                                          |
 * |---------|----------------|---------|------------------------------------------------|
 * | Asado   | ARS 1234567.89 | Ana     | Ana, Ben, Cam 411522.63 each                   |
 * | Ferry   | BRL 100        | Ben     | Ana 33.33, Ben 33.33, Cam 33.34 (Cam pending)  |
 * | Boat    | USD 50         | Cam     | Ana 20, Cam 30 (exact)                         |
 * | Gas     | ETH 0.004      | Ana     | Ana 0.002, Ben 0.002                           |
 * | Tapas   | BRL 5.35       | Ana     | Ana 2.675, Ben 2.675 (outside the project)     |
 * | Dinner  | ARS 60000      | Ana     | Ana 30000, Ben 30000 (locked)                  |
 * | Kiosk   | ARS 3000       | Ana     | Ana 1000, Sam 2000                             |
 *
 * Payments (project): Ben paid Ana ARS 100000 (finalized); Cam paid Ana
 * BRL 10 (proposed, counts). Outside the project: Tapas (above) and Lunch, EUR 12.50, Ana
 * paid, Ana 6.25 and Ben 6.25.
 */
import { randomUUID } from "node:crypto";
import { exportRouter } from "~/server/api/routers/export";
import { createCallerFactory } from "~/server/api/trpc";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { ParticipantType, SplitMode, VerificationStatus } from "~prisma";

const createCaller = createCallerFactory(exportRouter);

export async function namedUser(name: string) {
	const created = await createTestUser();
	const user = await adminDb.user.update({
		where: { id: created.user.id },
		data: { name, homeCurrency: "ARS" },
	});
	return { ...created, user };
}

export type TestUser = Awaited<ReturnType<typeof namedUser>>;

/** The export procedures, signed in as `user` (RLS on). */
export function exportCallerFor(user: TestUser["user"]) {
	return createCaller({
		db: adminDb,
		session: {
			user: {
				id: user.id,
				role: user.role,
				email: user.email,
				name: user.name,
				isActive: true,
				timeZone: "America/Argentina/Buenos_Aires",
			},
		} as never,
		headers: new Headers(),
	});
}

type Who = { type: ParticipantType; id: string };

interface Split {
	who: Who;
	share: string;
	status?: VerificationStatus;
}

interface Expense {
	description: string;
	amount: string;
	currency: string;
	date: string;
	paidBy: Who;
	splits: Split[];
	splitMode?: SplitMode;
	isLocked?: boolean;
	categoryId?: string;
	projectId?: string;
	billingPeriodId?: string;
}

export function seedExpense(e: Expense) {
	return adminDb.sharedTransaction.create({
		data: {
			description: e.description,
			amount: e.amount,
			currency: e.currency,
			date: new Date(`${e.date}T12:00:00Z`),
			splitMode: e.splitMode ?? "EQUAL",
			isLocked: e.isLocked ?? false,
			categoryId: e.categoryId ?? null,
			paidByType: e.paidBy.type,
			paidById: e.paidBy.id,
			createdByType: e.paidBy.type,
			createdById: e.paidBy.id,
			projectId: e.projectId ?? null,
			billingPeriodId: e.billingPeriodId ?? null,
			splitParticipants: {
				create: e.splits.map((s) => ({
					participantType: s.who.type,
					participantId: s.who.id,
					shareAmount: s.share,
					verificationStatus: s.status ?? "ACCEPTED",
				})),
			},
		},
	});
}

export async function seedCordoba() {
	const ana = await namedUser("Ana");
	const ben = await namedUser("Ben");
	const cam = await namedUser("Cam");
	const sam = await adminDb.shadowProfile.create({
		data: {
			createdById: ana.user.id,
			name: "Sam",
			email: `sam-${randomUUID()}@pg-test.invalid`,
		},
	});
	const project = await adminDb.project.create({
		data: {
			name: "Cordoba",
			description: "Sierras week",
			primaryCurrency: "ARS",
			createdById: ana.user.id,
			budgetAmount: "5000000",
			budgetCurrency: "ARS",
		},
	});
	const projectId = project.id;
	const member = (
		type: ParticipantType,
		id: string,
		role: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR",
	) =>
		adminDb.projectParticipant.create({
			data: { projectId, participantType: type, participantId: id, role },
		});
	await member("user", ana.user.id, "ORGANIZER");
	await member("user", ben.user.id, "EDITOR");
	await member("user", cam.user.id, "CONTRIBUTOR");
	await member("shadow", sam.id, "CONTRIBUTOR");

	const food = await adminDb.category.create({
		data: { name: "Food", color: "blue", userId: ana.user.id },
	});
	const period = await adminDb.billingPeriod.create({
		data: {
			projectId,
			label: "Oct 2026",
			startDate: new Date("2026-10-01T00:00:00Z"),
			endDate: new Date("2026-10-31T00:00:00Z"),
		},
	});

	const A: Who = { type: "user", id: ana.user.id };
	const B: Who = { type: "user", id: ben.user.id };
	const C: Who = { type: "user", id: cam.user.id };
	const S: Who = { type: "shadow", id: sam.id };
	const inProject = { projectId, billingPeriodId: period.id };

	await seedExpense({
		description: "Asado",
		amount: "1234567.89",
		currency: "ARS",
		date: "2026-10-05",
		paidBy: A,
		categoryId: food.id,
		...inProject,
		splits: [
			{ who: A, share: "411522.63" },
			{ who: B, share: "411522.63" },
			{ who: C, share: "411522.63" },
		],
	});
	await seedExpense({
		description: "Ferry",
		amount: "100",
		currency: "BRL",
		date: "2026-10-06",
		paidBy: B,
		...inProject,
		splits: [
			{ who: A, share: "33.33" },
			{ who: B, share: "33.33" },
			{ who: C, share: "33.34", status: "PENDING" },
		],
	});
	await seedExpense({
		description: "Boat",
		amount: "50",
		currency: "USD",
		date: "2026-10-07",
		paidBy: C,
		splitMode: "EXACT",
		...inProject,
		splits: [
			{ who: A, share: "20" },
			{ who: C, share: "30" },
		],
	});
	await seedExpense({
		description: "Gas",
		amount: "0.004",
		currency: "ETH",
		date: "2026-10-08",
		paidBy: A,
		...inProject,
		splits: [
			{ who: A, share: "0.002" },
			{ who: B, share: "0.002" },
		],
	});
	await seedExpense({
		description: "Tapas",
		amount: "5.35",
		currency: "BRL",
		date: "2026-10-09",
		paidBy: A,
		splits: [
			{ who: A, share: "2.675" },
			{ who: B, share: "2.675" },
		],
	});
	await seedExpense({
		description: "Dinner",
		amount: "60000",
		currency: "ARS",
		date: "2026-10-10",
		paidBy: A,
		isLocked: true,
		...inProject,
		splits: [
			{ who: A, share: "30000" },
			{ who: B, share: "30000" },
		],
	});
	await seedExpense({
		description: "Kiosk",
		amount: "3000",
		currency: "ARS",
		date: "2026-10-11",
		paidBy: A,
		...inProject,
		splits: [
			{ who: A, share: "1000" },
			{ who: S, share: "2000" },
		],
	});
	await seedExpense({
		description: "Lunch",
		amount: "12.50",
		currency: "EUR",
		date: "2026-10-02",
		paidBy: A,
		splits: [
			{ who: A, share: "6.25" },
			{ who: B, share: "6.25" },
		],
	});

	const payment = (
		from: Who,
		to: Who,
		amount: string,
		currency: string,
		status: "FINALIZED" | "PROPOSED",
	) =>
		adminDb.settlement.create({
			data: {
				fromParticipantType: from.type,
				fromParticipantId: from.id,
				toParticipantType: to.type,
				toParticipantId: to.id,
				amount,
				currency,
				status,
				projectId,
			},
		});
	await payment(B, A, "100000", "ARS", "FINALIZED");
	await payment(C, A, "10", "BRL", "PROPOSED");

	await seedPersonalBook(ana.user.id, food.id);

	return { ana, ben, cam, sam, project, period, refs: { A, B, C, S } };
}

/**
 * Ana's own book, for the account zip: a 7-digit ARS expense, a card in the
 * red (negative), and a wallet holding one satoshi-sized amount of ETH.
 */
async function seedPersonalBook(userId: string, categoryId: string) {
	await adminDb.expense.create({
		data: {
			userId,
			title: "Alquiler",
			amount: "1500000.5",
			currency: "ARS",
			date: new Date("2026-10-01T12:00:00Z"),
			categoryId,
			amountInUSD: "1000.33",
			exchangeRate: "1499.5",
			pricingSource: "manual",
		},
	});
	// 23:30 on Oct 7 in Buenos Aires (UTC-3) is already Oct 8 in UTC.
	await adminDb.expense.create({
		data: {
			userId,
			title: "Cena tarde",
			amount: "9000",
			currency: "ARS",
			date: new Date("2026-10-08T02:30:00Z"),
			categoryId,
			amountInUSD: "6",
			exchangeRate: "1500",
			pricingSource: "manual",
		},
	});
	const card = await adminDb.assetAccount.create({
		data: {
			userId,
			name: "Visa",
			type: "LIABILITY_CREDIT_CARD",
			currency: "ARS",
			balance: "-150000.25",
		},
	});
	await adminDb.assetAccount.create({
		data: {
			userId,
			name: "Wallet",
			type: "CRYPTO",
			currency: "ETH",
			balance: "0.00000001",
			interestRate: "0.125",
		},
	});
	await adminDb.assetSnapshot.create({
		data: {
			accountId: card.id,
			userId,
			date: new Date("2026-10-01T00:00:00Z"),
			balance: "-90000.1",
			balanceInUSD: "-60.02",
		},
	});
	await adminDb.recurringTemplate.create({
		data: {
			userId,
			name: "Gym",
			amount: "25000.75",
			currency: "ARS",
			frequency: "MONTHLY",
			nextDueDate: new Date("2026-11-01T00:00:00Z"),
		},
	});
}

export type Cordoba = Awaited<ReturnType<typeof seedCordoba>>;

/** Dates that change every day, made stable for a comparison. */
export function steady(text: string): string {
	return text
		.replace(/\d{4}-\d{2}-\d{2}(?=\.(csv|pdf|zip))/g, "<day>")
		.replace(
			/(Export Date: |Generated by Retrospend on )\d{4}-\d{2}-\d{2}/g,
			"$1<day>",
		);
}
