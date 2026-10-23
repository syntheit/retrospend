/**
 * Resets the e2e test DB and writes the personas (personas.ts) and their
 * ledger (ledger.ts). Global setup runs it before every suite, so it is
 * idempotent by construction: wipe, then write the same rows with the same
 * ids. Rows are written straight to Postgres as the DB owner (like the app's
 * admin paths), with the app's own split, rounding and USD rules from
 * @retrospend/domain, so the server reads them exactly as it reads rows it
 * wrote itself.
 *
 * The reset truncates every table, so it runs the same database check as
 * playwright.config.ts (../db-guard.ts) before touching anything.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { budgetPeriod } from "@retrospend/domain/fiscal-month";
import {
	computeAmountInUSD,
	roundUSD,
	toAmountString,
	toMinorUnits,
	toUSD,
} from "@retrospend/domain/money";
import { resolveSplits } from "@retrospend/domain/shared-split-computation";
import { fromWallTime, wallTime } from "@retrospend/domain/time-zone";
import { hashPassword } from "better-auth/crypto";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { allocatePayment } from "~/server/services/payments/allocate";
import { confirmationFor } from "~/server/services/payments/confirmation";
import { writePayment } from "~/server/services/payments/write";
import { resolveVerification } from "~/server/services/shared-expenses/auto-accept";
import { PrismaClient } from "~prisma";
import { assertE2eDatabase } from "../db-guard";
import {
	ACCOUNTS,
	type Anchor,
	BUDGETS,
	daysAgo,
	FLORIPA_MANUAL_SINCE_BACK,
	GLOBAL_BUDGET_ARS,
	historicBalance,
	MONTHLY_INCOME_ARS,
	personalExpenses,
	RECURRING,
	SEED_RATES,
	SETTLEMENTS,
	SHARED_ENTRIES,
	type SharedEntry,
	seedAnchor,
	seedRate,
} from "./ledger";
import {
	LUCIA,
	MARTIN,
	PAZ,
	type PersonKey,
	PROJECT_IDS,
	ref,
	SEED_TIME_ZONE,
	SEED_USERS,
	type SeedUser,
	SOFIA,
	seedId,
} from "./personas";

type Db = PrismaClient;

const USER_BY_KEY: Record<Exclude<PersonKey, "paz">, SeedUser> = {
	sofia: SOFIA,
	lucia: LUCIA,
	martin: MARTIN,
};

const categoryId = (user: SeedUser, name: string) =>
	seedId("cat", user.username, name);
const money = (amount: number, currency: string) =>
	toAmountString(amount, currency);
const usd = (amount: number, currency: string) =>
	money(computeAmountInUSD(amount, currency, seedRate(currency)), "USD");

async function resetDatabase(db: Db): Promise<void> {
	const tables = await db.$queryRaw<{ tablename: string }[]>`
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
	const list = tables.map((t) => `"${t.tablename}"`).join(", ");
	await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

async function writeUsers(db: Db): Promise<void> {
	await db.user.createMany({
		data: SEED_USERS.map((u) => ({
			id: u.id,
			name: u.name,
			username: u.username,
			email: u.email,
			emailVerified: true,
			homeCurrency: "ARS",
			defaultCurrency: "ARS",
			monthlyIncomeCurrency: "ARS",
			monthlyIncome:
				u.id === SOFIA.id ? money(MONTHLY_INCOME_ARS, "ARS") : null,
			language: u.language ?? "en",
		})),
	});
	const accounts = [];
	for (const u of SEED_USERS) {
		accounts.push({
			id: `e2e_account_${u.username}`,
			accountId: u.id,
			providerId: "credential",
			userId: u.id,
			password: await hashPassword(u.password),
		});
	}
	await db.account.createMany({ data: accounts });
	await db.category.createMany({
		data: SEED_USERS.flatMap((u) =>
			DEFAULT_CATEGORIES.map((c) => ({
				id: categoryId(u, c.name),
				name: c.name,
				color: c.color,
				userId: u.id,
			})),
		),
	});
	await db.shadowProfile.create({ data: { ...PAZ } });
}

async function writeRates(db: Db, anchor: Anchor): Promise<void> {
	// One rate per currency, a year before anything else, so every lookup
	// (nearest on or before the date) finds the same row.
	const date = new Date(Date.UTC(anchor.year - 1, anchor.month, 1));
	await db.exchangeRate.createMany({
		data: SEED_RATES.map((r) => ({
			id: seedId("rate", r.currency, r.type),
			date,
			currency: r.currency,
			type: r.type,
			rate: String(r.rate),
		})),
	});
}

async function writeExpenses(db: Db, anchor: Anchor): Promise<void> {
	await db.expense.createMany({
		data: personalExpenses(anchor).map((e, i) => ({
			id: `e2e_exp_${String(i).padStart(4, "0")}`,
			userId: SOFIA.id,
			title: e.title,
			amount: money(e.amount, e.currency),
			currency: e.currency,
			date: daysAgo(anchor, e.back),
			categoryId: categoryId(SOFIA, e.category),
			amountInUSD: usd(e.amount, e.currency),
			exchangeRate: String(seedRate(e.currency)),
			pricingSource: "MANUAL",
		})),
	});
}

async function writeProjects(db: Db): Promise<void> {
	await db.project.createMany({
		data: [
			{
				id: PROJECT_IDS.floripa,
				name: "Viaje a Florianópolis",
				description: "Verano con amigos, casa en Barra da Lagoa",
				primaryCurrency: "BRL",
				budgetAmount: money(9000, "BRL"),
				budgetCurrency: "BRL",
				// Switched to manual approval mid-trip (FLORIPA_MANUAL_SINCE_BACK).
				autoAcceptSplits: false,
				createdById: SOFIA.id,
			},
			{
				id: PROJECT_IDS.depto,
				name: "Depto Palermo",
				description: "Bills for the apartment, split in half with Martín",
				primaryCurrency: "ARS",
				createdById: SOFIA.id,
			},
		],
	});
	const members: [string, PersonKey[]][] = [
		[PROJECT_IDS.floripa, ["sofia", "lucia", "martin", "paz"]],
		[PROJECT_IDS.depto, ["sofia", "martin"]],
	];
	await db.projectParticipant.createMany({
		data: members.flatMap(([projectId, keys]) =>
			keys.map((key) => ({
				id: `e2e_pp_${projectId}_${key}`,
				projectId,
				...ref[key],
				role:
					key === "sofia"
						? ("ORGANIZER" as const)
						: key === "paz"
							? ("CONTRIBUTOR" as const)
							: ("EDITOR" as const),
			})),
		),
	});
}

/**
 * The app's own rule (auto-accept.ts), with the project's setting as it was
 * when the entry was added. Standalone splits always auto-accept. The
 * verification time is the entry's date, so reruns write the same rows.
 */
function verificationFor(entry: SharedEntry, key: PersonKey, at: Date) {
	const author = entry.createdBy ?? entry.paidBy;
	const projectAutoAccept =
		entry.project !== "floripa" || entry.back > FLORIPA_MANUAL_SINCE_BACK;
	const { status } = resolveVerification(
		ref[key],
		ref[author],
		projectAutoAccept,
	);
	return {
		verificationStatus: status,
		verifiedAt: status === "PENDING" ? null : at,
	};
}

async function writeSharedEntries(db: Db, anchor: Anchor): Promise<void> {
	for (const entry of SHARED_ENTRIES) {
		const author = entry.createdBy ?? entry.paidBy;
		const owner = USER_BY_KEY[author as Exclude<PersonKey, "paz">];
		const date = daysAgo(anchor, entry.back);
		const splits = resolveSplits({
			mode: entry.units ? "SHARES" : "EQUAL",
			amount: entry.amount,
			currency: entry.currency,
			paidBy: ref[entry.paidBy],
			participants: entry.with.map((key, i) => ({
				...ref[key],
				shareUnits: entry.units?.[i],
			})),
		});
		await db.sharedTransaction.create({
			data: {
				id: `e2e_tx_${entry.key}`,
				description: entry.description,
				amount: money(entry.amount, entry.currency),
				currency: entry.currency,
				date,
				categoryId: categoryId(owner, entry.category),
				splitMode: entry.units ? "SHARES" : "EQUAL",
				exchangeRate: String(seedRate(entry.currency)),
				paidByType: ref[entry.paidBy].participantType,
				paidById: ref[entry.paidBy].participantId,
				createdByType: "user",
				createdById: owner.id,
				projectId: entry.project ? PROJECT_IDS[entry.project] : null,
				createdAt: date,
				splitParticipants: {
					create: splits.map((s, i) => ({
						id: `e2e_split_${entry.key}_${entry.with[i]}`,
						participantType: s.participantType,
						participantId: s.participantId,
						shareAmount: money(s.shareAmount, entry.currency),
						shareUnits: s.shareUnits ?? null,
						...verificationFor(entry, entry.with[i] as PersonKey, date),
					})),
				},
			},
		});
	}
}

/**
 * Each payment goes through the app's own writer (payments/write.ts): the
 * Payment header, its settlement rows and audit entries, with the flags the
 * app gives a payment recorded by the payee (FINALIZED) or by a payer whose
 * payee is on Retrospend (PROPOSED). Every seeded payment pays one debt in
 * its own currency, so the allocation is a single cash row.
 */
async function writeSettlements(db: Db, anchor: Anchor): Promise<void> {
	for (const s of SETTLEMENTS) {
		const at = daysAgo(anchor, s.back);
		const { year, month, day } = wallTime(at, SEED_TIME_ZONE);
		const scope = s.project ? PROJECT_IDS[s.project] : null;
		const minor = toMinorUnits(s.amount, s.currency);
		const payer = ref[s.from];
		const payee = ref[s.to];
		const recordedByPayee = s.status === "FINALIZED";
		const allocation = allocatePayment({
			lines: [{ scope, currency: s.currency, owed: minor, oldest: null }],
			currency: s.currency,
			amount: minor,
			quotes: new Map(),
		});
		await db.$transaction((tx) =>
			writePayment(tx, {
				id: `e2e_pg_${s.key}`,
				parties: { payer, payee, recorder: recordedByPayee ? payee : payer },
				allocation,
				confirmation: confirmationFor(recordedByPayee, payee.participantType),
				paidOn: new Date(Date.UTC(year, month, day)),
				now: at,
				paymentMethod: s.method,
				note: null,
			}),
		);
	}
}

/** Start of the next `day` of the month in Buenos Aires after the anchor. */
function nextDayOfMonth(anchor: Anchor, day: number): Date {
	const month = anchor.day < day ? anchor.month : anchor.month + 1;
	return fromWallTime({ year: anchor.year, month, day }, SEED_TIME_ZONE);
}

async function writeRecurringAndBudgets(db: Db, anchor: Anchor): Promise<void> {
	await db.recurringTemplate.createMany({
		data: RECURRING.map((r) => {
			const next =
				"dayOfMonth" in r.due
					? nextDayOfMonth(anchor, r.due.dayOfMonth)
					: daysAgo(anchor, r.due.overdueDays);
			return {
				id: seedId("rec", r.key),
				userId: SOFIA.id,
				name: r.name,
				amount: money(r.amount, r.currency),
				currency: r.currency,
				categoryId: categoryId(SOFIA, r.category),
				frequency: "MONTHLY" as const,
				nextDueDate: next,
				anchorDay: wallTime(next, SEED_TIME_ZONE).day,
				autoPay: r.autoPay,
			};
		}),
	});
	const rows = [];
	for (const back of [2, 1, 0]) {
		const inMonth = fromWallTime(
			{ year: anchor.year, month: anchor.month - back, day: 1, hour: 12 },
			SEED_TIME_ZONE,
		);
		const period = budgetPeriod(inMonth, SEED_TIME_ZONE);
		rows.push({
			id: seedId("budget", "total", String(back)),
			userId: SOFIA.id,
			categoryId: null,
			amount: money(GLOBAL_BUDGET_ARS, "ARS"),
			currency: "ARS",
			period,
		});
		for (const [name, amount] of Object.entries(BUDGETS)) {
			rows.push({
				id: seedId("budget", name, String(back)),
				userId: SOFIA.id,
				categoryId: categoryId(SOFIA, name),
				amount: money(amount, "ARS"),
				currency: "ARS",
				period,
			});
		}
	}
	await db.budget.createMany({ data: rows });
}

async function writeWealth(db: Db, anchor: Anchor): Promise<void> {
	const today = new Date(Date.UTC(anchor.year, anchor.month, anchor.day));
	for (const [index, a] of ACCOUNTS.entries()) {
		const rate = seedRate(a.currency);
		const rateType = a.currency === "USD" ? null : "official";
		const id = seedId("asset", a.key);
		await db.assetAccount.create({
			data: {
				id,
				userId: SOFIA.id,
				name: a.name,
				type: a.type,
				currency: a.currency,
				balance: money(a.balance, a.currency),
				exchangeRate: String(rate),
				exchangeRateType: rateType,
				isLiquid: a.isLiquid,
				interestRate: a.card?.interestRate ?? null,
				minimumPayment: a.card
					? money(a.card.minimumPayment, a.currency)
					: null,
				dueDate: a.card?.dueDate ?? null,
				createdAt: new Date(Date.UTC(anchor.year, anchor.month - 6, 1)),
			},
		});
		const snapshots = [0, 1, 2, 3, 4, 5, 6].map((monthsBack) => {
			const balance =
				monthsBack === 0 ? a.balance : historicBalance(a, monthsBack, index);
			return {
				id: seedId("snap", a.key, String(monthsBack)),
				accountId: id,
				userId: SOFIA.id,
				date:
					monthsBack === 0
						? today
						: new Date(Date.UTC(anchor.year, anchor.month - monthsBack, 1)),
				balance: money(balance, a.currency),
				balanceInUSD: money(roundUSD(toUSD(balance, a.currency, rate)), "USD"),
				currency: a.currency,
				type: a.type,
				exchangeRateType: rateType,
			};
		});
		await db.assetSnapshot.createMany({ data: snapshots });
		await db.assetHistory.create({
			data: {
				id: seedId("history", a.key),
				assetId: id,
				userId: SOFIA.id,
				balance: money(a.balance, a.currency),
				recordedAt: daysAgo(anchor, 0),
			},
		});
	}
}

const UI_V2_MODES = ["OFF", "ADMINS", "ALL"] as const;
type UiV2Mode = (typeof UI_V2_MODES)[number];

/** The new shell's rollout for this database: E2E_UI_V2_MODE, else OFF. */
function uiV2ModeFromEnv(): UiV2Mode {
	const mode = process.env.E2E_UI_V2_MODE ?? "OFF";
	if (!UI_V2_MODES.includes(mode as UiV2Mode)) {
		throw new Error(`E2E_UI_V2_MODE must be one of ${UI_V2_MODES.join(", ")}`);
	}
	return mode as UiV2Mode;
}

/**
 * The settings row, written with the reset. Global setup's sign-ups are the
 * server's first settings read after the seed, so its 60 second cache holds
 * this row from the start and no test waits for the flag.
 */
async function writeAppSettings(db: Db, uiV2Mode: UiV2Mode): Promise<void> {
	await db.appSettings.create({
		// apiV1 on: the figure audit reads every tagged number back from
		// /api/v1/figures, whatever order the flows run in.
		data: { id: "app_settings_singleton", uiV2Mode, apiV1Mode: "ALL" },
	});
}

/** Wipes the e2e DB and writes the personas. Same input, same rows. */
export async function seedE2eDatabase(
	databaseUrl: string,
	anchor: Anchor = seedAnchor(),
	uiV2Mode: UiV2Mode = uiV2ModeFromEnv(),
): Promise<void> {
	assertE2eDatabase(databaseUrl);
	const db = new PrismaClient({
		adapter: new PrismaPg({ connectionString: databaseUrl }),
	});
	try {
		await resetDatabase(db);
		await writeAppSettings(db, uiV2Mode);
		await writeUsers(db);
		await writeRates(db, anchor);
		await writeExpenses(db, anchor);
		await writeProjects(db);
		await writeSharedEntries(db, anchor);
		await writeSettlements(db, anchor);
		await writeRecurringAndBudgets(db, anchor);
		await writeWealth(db, anchor);
	} finally {
		await db.$disconnect();
	}
}
