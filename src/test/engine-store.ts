/**
 * One user's Postgres rows as a device store: the raw rows of every table the
 * device figures read, in the engine port's shape, in a MemoryStore. The
 * conformance tests (device-registry.pg.test.ts) hold the device registry to
 * the server on it, and the device sync work (P16) reuses it to seed a store.
 *
 * Every row is read raw and none is filtered: a rejected share, a hidden
 * project's share and a row hidden from reports all go in, so the device
 * rules (participation, the fiscal month, the rest) are what is compared, not
 * copied from the server's own readers (getSharedExpenseShares is never used
 * here). The share rule itself is the one function both sides call
 * (countsAsShare); figures/share-rule.pg.test.ts holds them to each other.
 * Settings carry what a sync sends: the zone the server
 * resolved for the user (resolveTimeZone), the fiscal month start day and the
 * projects hidden from reports. The owed row holds the server's own reading
 * (owedOnce), as GET /sync/shares hands it to a device.
 *
 * The budget book family is the person's personal book (soloBook, the sync
 * rule) with everything that hangs off it, and the transfers a bill reads;
 * the budget snapshot is left empty, since only a pull of /sync/shares has the
 * server's block to put in it.
 *
 * The parity harness (P16) feeds its device store from the real v1 sync
 * routes instead; this builder is only its cross-check, so a row the routes
 * send is held to the row read straight from the tables.
 *
 * The root app does not depend on the engine package, so it is imported by
 * path, as expense-create-conformance.pg.test.ts does.
 */
import { userTransaction } from "~/server/db-tx";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { owedOnce } from "~/server/services/payments/figures";
import { soloBook } from "~/server/services/sync/book-entities";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import {
	type CloseSummary,
	MemoryStore,
	OWED_ID,
	type SettingsRow,
	type TableRows,
} from "../../packages/engine/src/index";
import { adminDb, fixtureDb } from "./pg-harness";

const text = (value: { toFixed(): string } | null) =>
	value === null ? null : value.toFixed();

async function settingsOf(userId: string): Promise<SettingsRow> {
	const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
	const hidden = await adminDb.projectParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			excludeFromAnalytics: true,
		},
		select: { projectId: true },
	});
	const defaults = user.defaultRateTypes as Record<string, string> | null;
	return {
		id: "user",
		homeCurrency: user.homeCurrency,
		timeZone: resolveTimeZone(user.timeZone),
		startDay: user.fiscalMonthStartDay,
		hiddenProjectIds: hidden.map((h) => h.projectId),
		...(defaults && Object.keys(defaults).length > 0
			? { defaultRateTypes: defaults }
			: {}),
	};
}

/** Your participations from the raw split rows, one per share, with their transaction's fields. */
async function sharesOf(userId: string): Promise<TableRows["shares"][]> {
	const rows = await adminDb.splitParticipant.findMany({
		where: { participantType: "user", participantId: userId },
		include: { transaction: { include: { category: true } } },
	});
	return rows.map((p) => ({
		id: p.id,
		expenseId: p.transactionId,
		shareAmount: p.shareAmount.toFixed(),
		verificationStatus: p.verificationStatus,
		currency: p.transaction.currency,
		date: p.transaction.date,
		projectId: p.transaction.projectId,
		exchangeRate: text(p.transaction.exchangeRate),
		// A category belongs to whoever created the expense (D19): it is yours
		// only when it is your own.
		categoryId:
			p.transaction.category?.userId === userId
				? p.transaction.categoryId
				: null,
	}));
}

/** Owed to you and You owe as the server's figure reads them, as the owed row. */
async function owedRowOf(userId: string): Promise<TableRows["owed"]> {
	const owed = await userTransaction(adminDb, userId, (tx) =>
		owedOnce(tx, userId),
	);
	if (owed instanceof FigureUnavailable)
		return { id: OWED_ID, missingRates: owed.missingRates };
	return {
		id: OWED_ID,
		currency: owed.currency,
		owedToYou: owed.owedToYou,
		youOwe: owed.youOwe,
	};
}

type StoredSummary = {
	envelopes: { id: string; rule: string; sweepToId: string | null }[];
	links?: Record<string, string>;
};

/** What the sync apply keeps of a close's summary: each envelope's rule and sweep, and the links. */
function summaryOf(stored: unknown): CloseSummary {
	const { envelopes, links } = stored as StoredSummary;
	return {
		envelopes: envelopes.map((e) => ({
			id: e.id,
			rule: e.rule,
			sweepToId: e.sweepToId,
		})),
		...(links === undefined ? {} : { links }),
	};
}

/** The personal book of `userId` and its rows, as the book family tables hold them. */
async function bookRowsOf(userId: string) {
	const book = await fixtureDb.budgetBook.findFirst({
		where: soloBook(userId),
	});
	if (!book)
		return {
			books: [],
			groups: [],
			envelopes: [],
			links: [],
			periods: [],
			closes: [],
			movements: [],
			wealth: [],
			plans: [],
		};
	const where = { bookId: book.id };
	const [groups, envelopes, links, periods, closes, movements, wealth, plans] =
		await Promise.all([
			fixtureDb.envelopeGroup.findMany({ where }),
			fixtureDb.envelope.findMany({ where }),
			fixtureDb.envelopeCategory.findMany({ where }),
			fixtureDb.bookPeriod.findMany({ where }),
			fixtureDb.monthClose.findMany({ where }),
			fixtureDb.budgetMovement.findMany({ where }),
			fixtureDb.wealthTransfer.findMany({ where }),
			fixtureDb.payoffPlan.findMany({ where }),
		]);
	return {
		books: [book],
		groups,
		envelopes,
		links,
		periods,
		closes,
		movements,
		wealth,
		plans,
	};
}

export async function engineStoreOf(userId: string): Promise<MemoryStore> {
	const [
		settings,
		expenses,
		shares,
		accounts,
		legs,
		snapshots,
		switches,
		rates,
		templates,
		categories,
		owed,
		book,
		transfers,
	] = await Promise.all([
		settingsOf(userId),
		fixtureDb.expense.findMany({
			where: { userId },
			include: { category: { select: { kind: true } } },
		}),
		sharesOf(userId),
		fixtureDb.assetAccount.findMany({ where: { userId } }),
		fixtureDb.accountLeg.findMany({ where: { userId } }),
		fixtureDb.assetSnapshot.findMany({ where: { userId } }),
		fixtureDb.assetRateType.findMany({ where: { userId } }),
		adminDb.exchangeRate.findMany(),
		fixtureDb.recurringTemplate.findMany({ where: { userId } }),
		fixtureDb.category.findMany({ where: { userId } }),
		owedRowOf(userId),
		bookRowsOf(userId),
		fixtureDb.transfer.findMany({ where: { userId } }),
	]);
	const byId = new Map(categories.map((c) => [c.id, c]));
	const categoryRefOf = (id: string | null) => {
		const c = id === null ? undefined : byId.get(id);
		return c ? { id: c.id, name: c.name, color: c.color, icon: c.icon } : null;
	};
	return new MemoryStore({
		rows: {
			settings: [settings],
			owed: [owed],
			categories: categories.map((c) => ({
				id: c.id,
				kind: c.kind,
				name: c.name,
				color: c.color,
				icon: c.icon,
			})),
			expenses: expenses.map((r) => ({
				id: r.id,
				status: r.status,
				direction: r.direction,
				entryKind: r.entryKind,
				inType: r.inType,
				isAmortizedParent: r.isAmortizedParent,
				isAmortizedChild: r.isAmortizedChild,
				parentId: r.parentId,
				amortizeMode: r.amortizeMode,
				keepInWealth: r.keepInWealth,
				recurringTemplateId: r.recurringTemplateId,
				budgetEnvelopeId: r.budgetEnvelopeId,
				excludeFromAnalytics: r.excludeFromAnalytics,
				categoryKind: r.category?.kind ?? null,
				categoryId: r.categoryId,
				date: r.date,
				currency: r.currency,
				amount: r.amount.toFixed(),
				amountInUSD: r.amountInUSD.toFixed(),
				homeCurrency: r.homeCurrency,
				homeAmount: text(r.homeAmount),
			})),
			shares,
			accounts: accounts.map((a) => ({
				id: a.id,
				type: a.type,
				currency: a.currency,
				balance: a.balance.toFixed(),
				exchangeRate: text(a.exchangeRate),
				exchangeRateType: a.exchangeRateType,
				interestRate: text(a.interestRate),
				minimumPayment: text(a.minimumPayment),
				dueDate: a.dueDate,
				closedAt: a.closedAt,
				createdAt: a.createdAt,
			})),
			legs: legs.map((l) => ({
				id: l.id,
				accountId: l.accountId,
				currency: l.currency,
				date: l.date,
				createdAt: l.createdAt,
				amount: l.amount.toFixed(),
				source: l.source,
				homeAmount: text(l.homeAmount),
				homeCurrency: l.homeCurrency,
			})),
			snapshots: snapshots.map((s) => ({
				id: s.id,
				accountId: s.accountId,
				date: s.date,
				recordedAt: s.recordedAt,
				balance: s.balance.toFixed(),
				currency: s.currency,
				exchangeRateType: s.exchangeRateType,
			})),
			rateSwitches: switches.map((r) => ({
				id: r.id,
				accountId: r.accountId,
				from: r.from,
				type: r.type,
				previousType: r.previousType,
				createdAt: r.createdAt,
			})),
			rates: rates.map((r) => ({
				id: r.id,
				currency: r.currency,
				type: r.type,
				rate: r.rate.toFixed(),
				date: r.date,
			})),
			recurringTemplates: templates.map((t) => ({
				id: t.id,
				name: t.name,
				amount: t.amount.toFixed(),
				currency: t.currency,
				frequency: t.frequency,
				nextDueDate: t.nextDueDate,
				anchorDay: t.anchorDay,
				direction: t.direction,
				isActive: t.isActive,
				autoPay: t.autoPay,
				amountMode: t.amountMode,
				// Joined here from the top-level category read: a nested select would
				// hand back a sealed name unopened in the sealed suite.
				category: categoryRefOf(t.categoryId),
			})),
			budgetBooks: book.books.map((b) => ({
				id: b.id,
				currency: b.currency,
				style: b.style,
				fundingSource: b.fundingSource,
				pausedAt: b.pausedAt,
				weekStartDay: b.weekStartDay,
				timeZone: b.timeZone,
				startDate: b.startDate,
				startMonth: b.startMonth,
				defaultEnvelopeId: b.defaultEnvelopeId,
				startingBalanceExpenseId: b.startingBalanceExpenseId,
			})),
			envelopeGroups: book.groups.map((g) => ({
				id: g.id,
				bookId: g.bookId,
				name: g.name,
				sortOrder: g.sortOrder,
				role: g.role,
				targetKind: g.targetKind,
				targetValue: text(g.targetValue),
				mainEnvelopeId: g.mainEnvelopeId,
				archivedAt: g.archivedAt,
			})),
			envelopes: book.envelopes.map((e) => ({
				id: e.id,
				bookId: e.bookId,
				groupId: e.groupId,
				name: e.name,
				icon: e.icon,
				color: e.color,
				kind: e.kind,
				sortOrder: e.sortOrder,
				targetAmount: text(e.targetAmount),
				targetMode: e.targetMode,
				targetCadence: e.targetCadence,
				targetMonthlyAmount: text(e.targetMonthlyAmount),
				targetCurrency: e.targetCurrency,
				targetDueDate: e.targetDueDate,
				targetRepeat: e.targetRepeat,
				targetStartMonth: e.targetStartMonth,
				targetTemplateId: e.targetTemplateId,
				targetLiabilityId: e.targetLiabilityId,
				leftoverRule: e.leftoverRule,
				leftoverSweepToId: e.leftoverSweepToId,
				wealthAccountId: e.wealthAccountId,
				wealthDedicated: e.wealthDedicated,
				archivedAt: e.archivedAt,
			})),
			envelopeCategories: book.links.map((l) => ({
				id: l.id,
				bookId: l.bookId,
				envelopeId: l.envelopeId,
				categoryId: l.categoryId,
			})),
			bookPeriods: book.periods.map((p) => ({
				id: p.id,
				bookId: p.bookId,
				fromMonth: p.fromMonth,
				startDay: p.startDay,
				rateType: p.rateType,
			})),
			monthCloses: book.closes.map((c) => ({
				id: c.id,
				bookId: c.bookId,
				month: c.month,
				summary: summaryOf(c.summary),
			})),
			budgetMovements: book.movements.map((m) => ({
				id: m.id,
				bookId: m.bookId,
				month: m.month,
				fromEnvelopeId: m.fromEnvelopeId,
				toEnvelopeId: m.toEnvelopeId,
				amount: m.amount.toFixed(),
			})),
			wealthTransfers: book.wealth.map((w) => ({
				id: w.id,
				bookId: w.bookId,
				direction: w.direction,
				envelopeId: w.envelopeId,
				date: w.date,
				amount: w.amount.toFixed(),
			})),
			payoffPlans: book.plans.map((p) => ({
				id: p.id,
				bookId: p.bookId,
				strategy: p.strategy,
				extraMonthly: p.extraMonthly.toFixed(),
				customOrder: p.customOrder as string[],
				envelopeId: p.envelopeId,
			})),
			transfers: transfers.map((t) => ({
				id: t.id,
				date: t.date,
				toAccountId: t.toAccountId,
				toAmount: t.toAmount.toFixed(),
				toCurrency: t.toCurrency,
				feeExpenseId: t.feeExpenseId,
			})),
		},
	});
}
