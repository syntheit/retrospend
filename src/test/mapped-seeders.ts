/**
 * Create data for every mapped model (E2EE D11 PR 3.2 and 4.2): the pg tests
 * that read sealed cells and the ones that write them seed rows the same way.
 * Each call gives fresh values (unique where the schema needs them) with every
 * mapped column set, and ARS amounts where money appears.
 */
import { randomUUID } from "node:crypto";
import type { MappedModel } from "~/server/crypto/fields";
import { adminDb } from "./pg-harness";

export const day = new Date("2026-11-02T12:00:00Z");
export const text = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

/** Parents a seeder needs, made once per owner. */
export interface Ctx {
	owner: string;
	project: () => Promise<string>;
	book: () => Promise<string>;
	envelope: () => Promise<string>;
	sharedTx: () => Promise<string>;
	shadow: () => Promise<string>;
	magicLink: () => Promise<string>;
}

const once = <T>(make: () => Promise<T>) => {
	let made: Promise<T> | undefined;
	return () => {
		made ??= make();
		return made;
	};
};

export function ctxFor(owner: string): Ctx {
	const project = once(
		async () =>
			(
				await adminDb.project.create({
					data: { name: "P", createdById: owner },
				})
			).id,
	);
	const book = once(
		async () =>
			(
				await adminDb.budgetBook.create({
					data: {
						currency: "ARS",
						startDate: day,
						startMonth: 202611,
						createdById: owner,
					},
				})
			).id,
	);
	const envelope = once(
		async () =>
			(
				await adminDb.envelope.create({
					data: { bookId: await book(), name: "E", sortOrder: 0 },
				})
			).id,
	);
	const sharedTx = once(
		async () =>
			(
				await adminDb.sharedTransaction.create({
					data: {
						description: "S",
						amount: "15000",
						currency: "ARS",
						date: day,
						paidByType: "user",
						paidById: owner,
						createdByType: "user",
						createdById: owner,
						projectId: await project(),
					},
				})
			).id,
	);
	const shadow = once(
		async () =>
			(
				await adminDb.shadowProfile.create({
					data: { createdById: owner, name: "Ana" },
				})
			).id,
	);
	const magicLink = once(
		async () =>
			(
				await adminDb.magicLink.create({
					data: { projectId: await project(), createdById: owner },
				})
			).id,
	);
	return { owner, project, book, envelope, sharedTx, shadow, magicLink };
}

export type Data = Record<string, unknown>;

/**
 * Fresh create data per call (unique values where the schema needs them),
 * with every mapped column set.
 */
export const SEEDERS: Record<MappedModel, (c: Ctx) => Promise<Data>> = {
	Apikey: async (c) => ({
		id: randomUUID(),
		referenceId: c.owner,
		key: randomUUID(),
		createdAt: day,
		updatedAt: day,
		name: text("key"),
	}),
	AssetAccount: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Savings"),
		type: "CASH",
		currency: "ARS",
		balance: "250000",
	}),
	BillingPeriod: async (c) => ({
		id: randomUUID(),
		projectId: await c.project(),
		label: text("November"),
		startDate: day,
		endDate: day,
	}),
	BudgetBook: async (c) => ({
		id: randomUUID(),
		// One personal book per user; shared books have no such limit.
		isPersonal: false,
		currency: "ARS",
		startDate: day,
		startMonth: 202611,
		createdById: c.owner,
		name: text("Home book"),
	}),
	BudgetMovement: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		month: 202611,
		amount: "5000",
		kind: "ASSIGN",
		actorUserId: c.owner,
		toEnvelopeId: await c.envelope(),
		note: text("top up"),
	}),
	Category: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Food"),
		color: "blue",
	}),
	Envelope: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		name: text("Groceries"),
		sortOrder: 1,
	}),
	EnvelopeGroup: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		name: text("Needs"),
		sortOrder: 1,
	}),
	EnvelopeChange: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		kind: "UPDATE",
		before: {},
		actorUserId: c.owner,
		previousName: text("Old name"),
	}),
	Expense: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		title: text("Rent"),
		description: text("November"),
		location: text("Buenos Aires"),
		amount: "150000",
		currency: "ARS",
		date: day,
		amountInUSD: "100",
		exchangeRate: "1500",
		pricingSource: "MANUAL",
	}),
	ExportJob: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		kind: "project_csv",
		params: {},
		timeZone: "UTC",
		expiresAt: day,
		fileName: text("trip.csv"),
	}),
	ErrorReport: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		kind: "crash",
		message: text("Render failed"),
		stack: text("at bundle.js:12:3"),
		occurredAt: day,
	}),
	Feedback: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		message: text("Love it"),
		pageUrl: "/",
		adminNote: text("Thanks"),
	}),
	FixRequest: async (c) => ({
		id: randomUUID(),
		transactionId: await c.sharedTx(),
		requestedByType: "user",
		requestedById: c.owner,
		askedType: "shadow",
		askedId: await c.shadow(),
		message: text("Wrong amount"),
		reply: text("Fixed"),
	}),
	GuestSession: async (c) => ({
		id: randomUUID(),
		name: text("Guest"),
		email: `${randomUUID()}@pg-test.invalid`,
		magicLinkId: await c.magicLink(),
		projectId: await c.project(),
		sessionToken: randomUUID(),
	}),
	ImportJob: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		type: "CSV",
		fileName: text("bank.csv"),
		fileSize: 1,
		fileType: "text/csv",
	}),
	IncomeRule: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		sortOrder: 0,
		name: text("Salary"),
		matchTitle: text("ACME"),
		action: "PERCENT",
		envelopeId: await c.envelope(),
	}),
	Payment: async (c) => ({
		id: randomUUID(),
		payerType: "user",
		payerId: c.owner,
		payeeType: "shadow",
		payeeId: await c.shadow(),
		amount: "7500",
		currency: "ARS",
		paidOn: day,
		recordedByType: "user",
		recordedById: c.owner,
		note: text("for dinner"),
		paymentMethod: text("Mercado Pago"),
	}),
	PaymentMethod: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		type: "bank",
		rank: 0,
		label: text("Bank"),
		identifier: text("CBU 123"),
	}),
	Project: async (c) => ({
		id: randomUUID(),
		createdById: c.owner,
		name: text("Trip"),
		description: text("Bariloche"),
	}),
	RecurringTemplate: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Gym"),
		amount: "20000",
		currency: "ARS",
		frequency: "MONTHLY",
		nextDueDate: day,
		paymentSource: text("Visa"),
		websiteUrl: text("https://gym.example"),
	}),
	PushDevice: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		platform: "IOS",
		transport: "APNS",
		token: randomUUID(),
		addressHash: randomUUID(),
		deviceName: text("iPhone"),
	}),
	Settlement: async (c) => ({
		id: randomUUID(),
		fromParticipantType: "user",
		fromParticipantId: c.owner,
		toParticipantType: "shadow",
		toParticipantId: await c.shadow(),
		amount: "7500",
		currency: "ARS",
		projectId: await c.project(),
		note: text("cash"),
		paymentMethod: text("Efectivo"),
		rejectedReason: text("not yet"),
	}),
	ShadowProfile: async (c) => ({
		id: randomUUID(),
		createdById: c.owner,
		name: text("Luis"),
	}),
	SharedTransaction: async (c) => ({
		id: randomUUID(),
		description: text("Dinner"),
		notes: text("with wine"),
		receiptUrl: `https://receipts.example/${randomUUID()}`,
		amount: "30000",
		currency: "ARS",
		date: day,
		paidByType: "user",
		paidById: c.owner,
		createdByType: "user",
		createdById: c.owner,
		projectId: await c.project(),
	}),
	SplitParticipant: async (c) => ({
		id: randomUUID(),
		transactionId: await c.sharedTx(),
		participantType: "shadow",
		participantId: randomUUID(),
		shareAmount: "7500",
		rejectionReason: text("not mine"),
	}),
	Transfer: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		kind: "TRANSFER",
		date: day,
		fromAmount: "10000",
		fromCurrency: "ARS",
		toAmount: "10000",
		toCurrency: "ARS",
		note: text("to savings"),
	}),
	User: async () => {
		const id = randomUUID();
		return {
			id,
			name: text("Marta"),
			username: `u_${id.replaceAll("-", "")}`,
			email: `${id}@pg-test.invalid`,
		};
	},
	WealthTransfer: async (c) => ({
		id: randomUUID(),
		bookId: await c.book(),
		direction: "TO_WEALTH",
		date: day,
		amount: "5000",
		actorUserId: c.owner,
		note: text("to the fund"),
	}),
	Webhook: async (c) => ({
		id: randomUUID(),
		userId: c.owner,
		name: text("Zapier"),
		url: "https://hooks.example/x",
		secretCipher: "x",
		secretStart: "x",
	}),
};

type Call = (args: unknown) => Promise<unknown>;
export type Delegate = Record<
	| "findMany"
	| "findFirst"
	| "findUnique"
	| "create"
	| "createMany"
	| "createManyAndReturn"
	| "update"
	| "upsert"
	| "delete",
	Call
>;
export const delegateOf = (client: unknown, model: string): Delegate =>
	(client as Record<string, Delegate>)[
		model[0]?.toLowerCase() + model.slice(1)
	] as Delegate;
