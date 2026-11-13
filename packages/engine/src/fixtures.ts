/** One valid row per table, for the conformance suite and the tests. */
import type { TableName, TableRows } from "./port";

const at = (iso: string) => new Date(iso);

/** One valid row per table, with the given id. */
const FIXTURES: { [T in TableName]: (id: string) => TableRows[T] } = {
	expenses: (id) => ({
		id,
		status: "FINALIZED",
		direction: "OUT",
		entryKind: "STANDARD",
		inType: null,
		isAmortizedParent: false,
		excludeFromAnalytics: false,
		categoryKind: null,
		categoryId: null,
		date: at("2026-03-05T12:00:00Z"),
		currency: "ARS",
		amount: "1000.50",
		amountInUSD: "1",
		homeCurrency: "ARS",
		homeAmount: "1000.50",
	}),
	shares: (id) => ({
		id,
		expenseId: "e1",
		shareAmount: "250",
		verificationStatus: "VERIFIED",
		currency: "ARS",
		date: at("2026-03-06T12:00:00Z"),
		projectId: null,
		exchangeRate: "1000",
		categoryId: null,
	}),
	legs: (id) => ({
		id,
		accountId: "acc-1",
		currency: "ARS",
		date: at("2026-03-01T00:00:00Z"),
		createdAt: at("2026-03-01T08:00:00Z"),
		amount: "-1000.50",
		source: "TRANSFER",
		homeAmount: null,
		homeCurrency: null,
	}),
	snapshots: (id) => ({
		id,
		accountId: "acc-1",
		date: at("2026-03-01T00:00:00Z"),
		recordedAt: at("2026-03-01T09:00:00Z"),
		balance: "50000",
		currency: "ARS",
		exchangeRateType: null,
	}),
	accounts: (id) => ({
		id,
		type: "CASH",
		currency: "ARS",
		balance: "50000",
		exchangeRate: "1000",
		exchangeRateType: "blue",
		closedAt: null,
		createdAt: at("2026-01-01T00:00:00Z"),
	}),
	rateSwitches: (id) => ({
		id,
		accountId: "acc-1",
		from: at("2026-02-01T00:00:00Z"),
		type: "blue",
		previousType: "official",
		createdAt: at("2026-02-01T10:00:00Z"),
	}),
	rates: (id) => ({
		id,
		currency: "ARS",
		type: "blue",
		rate: "1545",
		date: at("2026-03-05T00:00:00Z"),
	}),
	rateSync: (id) => ({ id, asOf: "2026-03-05T09:05:00.000Z" }),
	budgetMovements: (id) => ({
		id,
		month: 202603,
		fromEnvelopeId: null,
		toEnvelopeId: "env-1",
		amount: "1200",
	}),
	recurringTemplates: (id) => ({
		id,
		name: "Rent",
		amount: "300000",
		currency: "ARS",
		frequency: "MONTHLY",
		nextDueDate: at("2026-04-01T00:00:00Z"),
		anchorDay: 1,
		direction: "OUT",
		isActive: true,
		autoPay: false,
		amountMode: "FIXED",
		category: null,
	}),
	settings: (id) => ({
		id,
		homeCurrency: "ARS",
		timeZone: "America/Argentina/Buenos_Aires",
		startDay: 1,
		hiddenProjectIds: [],
	}),
};

/** A row for `table`, for suites that need one. */
export function fixtureRow<T extends TableName>(table: T, id: string) {
	return FIXTURES[table](id) as TableRows[T];
}
