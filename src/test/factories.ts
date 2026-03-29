/**
 * Test Data Factories
 *
 * Factory functions that return valid objects with sensible defaults.
 * All IDs are unique per call (using a monotonic counter + timestamp).
 * Override any field by passing it in the overrides argument.
 *
 * Usage:
 *   const user = makeUser({ id: "user-1", role: "ADMIN" })
 *   const expense = makeExpense({ amount: 50, currency: "EUR" })
 *   db.user.findUnique.mockResolvedValue(user)
 */

// ── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;

function uid(prefix: string): string {
	return `${prefix}-${++_counter}`;
}

// ── User ──────────────────────────────────────────────────────────────────────

export type TestUser = {
	id: string;
	name: string;
	email: string;
	username: string | null;
	role: "USER" | "ADMIN";
	isActive: boolean;
	emailVerified: boolean;
	createdAt: Date;
	updatedAt: Date;
	avatarPath: string | null;
	image: string | null;
};

export function makeUser(overrides: Partial<TestUser> = {}): TestUser {
	const id = overrides.id ?? uid("user");
	return {
		id,
		name: "Test User",
		email: `user-${id}@example.com`,
		username: null,
		role: "USER",
		isActive: true,
		emailVerified: true,
		createdAt: new Date("2024-01-01"),
		updatedAt: new Date("2024-01-01"),
		avatarPath: null,
		image: null,
		...overrides,
	};
}

// ── Category ──────────────────────────────────────────────────────────────────

export type TestCategory = {
	id: string;
	name: string;
	color: string;
	icon: string | null;
	userId: string;
};

export function makeCategory(overrides: Partial<TestCategory> = {}): TestCategory {
	return {
		id: uid("cat"),
		name: "Food",
		color: "blue",
		icon: null,
		userId: uid("user"),
		...overrides,
	};
}

// ── Expense ───────────────────────────────────────────────────────────────────

export type TestExpense = {
	id: string;
	title: string;
	amount: number;
	currency: string;
	exchangeRate: number | null;
	amountInUSD: number | null;
	date: Date;
	location: string | null;
	description: string | null;
	categoryId: string | null;
	userId: string;
	isAmortized: boolean;
	amortizedOver: number | null;
	pricingSource: string;
	createdAt: Date;
	updatedAt: Date;
};

export function makeExpense(overrides: Partial<TestExpense> = {}): TestExpense {
	return {
		id: uid("exp"),
		title: "Test Expense",
		amount: 100,
		currency: "USD",
		exchangeRate: 1,
		amountInUSD: 100,
		date: new Date("2024-06-15"),
		location: null,
		description: null,
		categoryId: null,
		userId: uid("user"),
		isAmortized: false,
		amortizedOver: null,
		pricingSource: "IMPORTED",
		createdAt: new Date("2024-01-01"),
		updatedAt: new Date("2024-01-01"),
		...overrides,
	};
}

// ── Budget ────────────────────────────────────────────────────────────────────

export type TestBudget = {
	id: string;
	amount: number;
	type: "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";
	currency: string;
	categoryId: string | null;
	userId: string;
};

export function makeBudget(overrides: Partial<TestBudget> = {}): TestBudget {
	return {
		id: uid("budget"),
		amount: 500,
		type: "FIXED",
		currency: "USD",
		categoryId: null,
		userId: uid("user"),
		...overrides,
	};
}

// ── Asset ─────────────────────────────────────────────────────────────────────

export type TestAsset = {
	id: string;
	name: string;
	type: "SAVINGS" | "INVESTMENT" | "REAL_ESTATE" | "CRYPTO" | "OTHER";
	currency: string;
	balance: number;
	balanceInUSD: number;
	exchangeRate: number | null;
	isLiquid: boolean;
	isLiability: boolean;
	userId: string;
};

export function makeAsset(overrides: Partial<TestAsset> = {}): TestAsset {
	return {
		id: uid("asset"),
		name: "Savings Account",
		type: "SAVINGS",
		currency: "USD",
		balance: 1000,
		balanceInUSD: 1000,
		exchangeRate: null,
		isLiquid: true,
		isLiability: false,
		userId: uid("user"),
		...overrides,
	};
}

// ── Project ───────────────────────────────────────────────────────────────────

export type TestProject = {
	id: string;
	name: string;
	type: "TRIP" | "ONGOING" | "SOLO" | "ONE_TIME" | "GENERAL";
	description: string | null;
	status: "ACTIVE" | "ARCHIVED";
	createdById: string;
	primaryCurrency: string;
	visibility: "PRIVATE" | "PUBLIC";
	createdAt: Date;
	updatedAt: Date;
};

export function makeProject(overrides: Partial<TestProject> = {}): TestProject {
	return {
		id: uid("proj"),
		name: "Test Project",
		type: "GENERAL",
		description: null,
		status: "ACTIVE",
		createdById: uid("user"),
		primaryCurrency: "USD",
		visibility: "PRIVATE",
		createdAt: new Date("2024-01-01"),
		updatedAt: new Date("2024-01-01"),
		...overrides,
	};
}

// ── ProjectParticipant ────────────────────────────────────────────────────────

export type TestProjectParticipant = {
	id: string;
	projectId: string;
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	role: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";
	joinedAt: Date;
};

export function makeProjectParticipant(
	overrides: Partial<TestProjectParticipant> = {},
): TestProjectParticipant {
	return {
		id: uid("pp"),
		projectId: uid("proj"),
		participantType: "user",
		participantId: uid("user"),
		role: "CONTRIBUTOR",
		joinedAt: new Date("2024-01-01"),
		...overrides,
	};
}

// ── SharedTransaction ─────────────────────────────────────────────────────────

export type TestSharedTransaction = {
	id: string;
	projectId: string;
	title: string;
	amount: number;
	currency: string;
	amountInUSD: number | null;
	date: Date;
	paidByType: "user" | "guest" | "shadow";
	paidById: string;
	status: "PROPOSED" | "FINALIZED";
	categoryId: string | null;
};

export function makeSharedTransaction(
	overrides: Partial<TestSharedTransaction> = {},
): TestSharedTransaction {
	return {
		id: uid("tx"),
		projectId: uid("proj"),
		title: "Shared Dinner",
		amount: 100,
		currency: "USD",
		amountInUSD: 100,
		date: new Date("2024-06-15"),
		paidByType: "user",
		paidById: uid("user"),
		status: "FINALIZED",
		categoryId: null,
		...overrides,
	};
}

// ── SplitParticipant ──────────────────────────────────────────────────────────

export type TestSplitParticipant = {
	id: string;
	transactionId: string;
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	shareAmount: number;
	verificationStatus: "PENDING" | "VERIFIED";
	hasUnseenChanges: boolean;
};

export function makeSplitParticipant(
	overrides: Partial<TestSplitParticipant> = {},
): TestSplitParticipant {
	return {
		id: uid("sp"),
		transactionId: uid("tx"),
		participantType: "user",
		participantId: uid("user"),
		shareAmount: 50,
		verificationStatus: "PENDING",
		hasUnseenChanges: false,
		...overrides,
	};
}

// ── Settlement ────────────────────────────────────────────────────────────────

export type TestSettlement = {
	id: string;
	projectId: string | null;
	fromParticipantType: "user" | "guest" | "shadow";
	fromParticipantId: string;
	toParticipantType: "user" | "guest" | "shadow";
	toParticipantId: string;
	amount: number;
	currency: string;
	convertedAmount: number | null;
	convertedCurrency: string | null;
	exchangeRateUsed: number | null;
	paymentMethod: string | null;
	note: string | null;
	confirmedByPayer: boolean;
	confirmedByPayee: boolean;
	status: "PROPOSED" | "FINALIZED";
	initiatedAt: Date;
	settledAt: Date | null;
};

export function makeSettlement(overrides: Partial<TestSettlement> = {}): TestSettlement {
	return {
		id: uid("settle"),
		projectId: null,
		fromParticipantType: "user",
		fromParticipantId: uid("user"),
		toParticipantType: "user",
		toParticipantId: uid("user"),
		amount: 100,
		currency: "USD",
		convertedAmount: null,
		convertedCurrency: null,
		exchangeRateUsed: null,
		paymentMethod: null,
		note: null,
		confirmedByPayer: true,
		confirmedByPayee: false,
		status: "PROPOSED",
		initiatedAt: new Date(),
		settledAt: null,
		...overrides,
	};
}
