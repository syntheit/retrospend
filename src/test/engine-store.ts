/**
 * One user's Postgres rows as a device store: the raw rows of every table the
 * device figures read, in the engine port's shape, in a MemoryStore. The
 * conformance tests (device-registry.pg.test.ts) hold the device registry to
 * the server on it, and the device sync work (P16) reuses it to seed a store.
 *
 * Every row is read raw and none is filtered: a rejected share, a hidden
 * project's share and a row hidden from reports all go in, so the device
 * rules (participation, REJECTED, hidden projects, the fiscal month) are what
 * is compared, not copied from the server's own readers (getSharedExpenseShares
 * is never used here). Settings carry what a sync sends: the zone the server
 * resolved for the user (resolveTimeZone), the fiscal month start day and the
 * projects hidden from reports.
 *
 * The root app does not depend on the engine package, so it is imported by
 * path, as expense-create-conformance.pg.test.ts does.
 */
import { resolveTimeZone } from "~/server/services/user-time-zone";
import {
	MemoryStore,
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
		fixtureDb.recurringTemplate.findMany({
			where: { userId },
			include: {
				category: {
					select: { id: true, name: true, color: true, icon: true },
				},
			},
		}),
	]);
	return new MemoryStore({
		rows: {
			settings: [settings],
			expenses: expenses.map((r) => ({
				id: r.id,
				status: r.status,
				direction: r.direction,
				entryKind: r.entryKind,
				inType: r.inType,
				isAmortizedParent: r.isAmortizedParent,
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
				category: t.category,
			})),
		},
	});
}
