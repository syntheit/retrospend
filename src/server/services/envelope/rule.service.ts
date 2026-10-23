/**
 * Income rules (SPEC §5.10, D71): the rules list, and running them on money
 * in exactly once.
 *
 * - Rules run on every income row that enters To assign, created after the
 *   rule. The money-in service may run them right away (runRulesFor); rows
 *   the Go sidecar posts run lazily on the next budget read
 *   (runPendingRules). Either way under the book lock, and the
 *   income_rule_run primary key makes the run exactly-once.
 * - A row changes (amount, date, deleted, no longer budget income): the
 *   next read writes a delta with the rules recorded on the first run, a
 *   delete reverts. A row whose value is missing a rate waits: its rules
 *   run once a rate values it (R14: never at 1).
 * - Undoing a rule batch marks the row "rules skipped" (movement undo).
 *
 * Title matching happens here only (E2EE known exception, TITLE rules).
 */
import { randomUUID } from "node:crypto";
import type { RuleRunDto } from "~/lib/schemas/envelope-plan";
import type { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { findPersonalBook, type LoadedBook, loadBook } from "./inputs";
import { freeze } from "./load-state";
import { forgetMonthViews } from "./month-read";
import { lockBook } from "./movement-state";
import {
	fingerprintOf,
	type IncomeRowFields,
	isBudgetIncome,
	loadRecord,
	storeRecord,
	toRule,
} from "./rule-store";
import {
	type IncomeRule,
	type MoneyInWithMonth,
	planRuleRun,
	type RecordedRun,
	type RuleBatch,
	type RuleLine,
} from "./rules";
import { fromMinor } from "./units";

type Tx = Prisma.TransactionClient;

export const ROW_SELECT = {
	id: true,
	amount: true,
	currency: true,
	amountInUSD: true,
	homeCurrency: true,
	homeAmount: true,
	date: true,
	direction: true,
	entryKind: true,
	inType: true,
	keepInWealth: true,
	status: true,
	categoryId: true,
	recurringTemplateId: true,
	title: true,
	createdAt: true,
} as const;

export type IncomeRow = IncomeRowFields & {
	amountInUSD: Prisma.Decimal | null;
	homeCurrency: string | null;
	homeAmount: Prisma.Decimal | null;
	categoryId: string | null;
	recurringTemplateId: string | null;
	title: string;
	createdAt: Date;
};

interface BookHead {
	id: string;
	userId: string;
	startDate: Date;
}

interface Pending {
	/** Eligible rows created after a rule with no run yet. */
	fresh: IncomeRow[];
	/** Runs with a standing batch whose row changed or is gone. */
	changed: Array<{ expenseId: string; row: IncomeRow | null }>;
}

/** Active rules of the book, oldest first. */
export async function activeRules(tx: Tx, bookId: string, H: string) {
	const rows = await tx.incomeRule.findMany({
		where: { bookId, active: true, archivedAt: null },
		orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
	});
	return rows.map((r) => toRule(r, H));
}

async function pendingFor(
	tx: Tx,
	b: BookHead,
	rules: readonly IncomeRule[],
): Promise<Pending> {
	const open = await tx.incomeRuleRun.findMany({
		where: { bookId: b.id, skipped: false, batchId: { not: null } },
		select: { expenseId: true, fingerprint: true },
	});
	const openRows = open.length
		? await tx.expense.findMany({
				where: { id: { in: open.map((r) => r.expenseId) } },
				select: ROW_SELECT,
			})
		: [];
	const byId = new Map(openRows.map((r) => [r.id, r]));
	const changed = open
		.map((r) => ({
			expenseId: r.expenseId,
			row: byId.get(r.expenseId) ?? null,
			print: r.fingerprint,
		}))
		.filter((r) => fingerprintOf(r.row) !== r.print)
		.map(({ expenseId, row }) => ({ expenseId, row }));
	if (rules.length === 0) return { fresh: [], changed };
	const since = new Date(Math.min(...rules.map((r) => r.createdAtMs)));
	const candidates = await tx.expense.findMany({
		where: {
			userId: b.userId,
			direction: "IN",
			entryKind: "STANDARD",
			inType: "INCOME",
			keepInWealth: false,
			status: "FINALIZED",
			createdAt: { gt: since },
			date: { gte: b.startDate },
		},
		select: ROW_SELECT,
	});
	const ran = candidates.length
		? await tx.incomeRuleRun.findMany({
				where: { expenseId: { in: candidates.map((c) => c.id) } },
				select: { expenseId: true },
			})
		: [];
	const done = new Set(ran.map((r) => r.expenseId));
	return { fresh: candidates.filter((c) => !done.has(c.id)), changed };
}

/** A row as the allocator reads it: valued and dated by the load's valuer. */
export function moneyInRow(loaded: LoadedBook, r: IncomeRow): MoneyInWithMonth {
	const { date, month } = loaded.valuer.dated(r.date);
	return {
		id: r.id,
		direction: r.direction,
		entryKind: r.entryKind,
		inType: r.inType,
		// Anything that is no longer budget income reads as out of the budget: its batch reverts.
		keptInWealth: !isBudgetIncome(r),
		categoryId: r.categoryId,
		templateId: r.recurringTemplateId,
		title: r.title,
		currency: r.currency,
		bookValue: isBudgetIncome(r) ? loaded.valuer.value(r, date, month) : 0,
		createdAtMs: r.createdAt.getTime(),
		month,
	};
}

/** Writes one row's batches as RULE movements (one batch id) and returns the lines. */
async function writeBatches(
	tx: Tx,
	loaded: LoadedBook,
	userId: string,
	expenseId: string | null,
	batches: readonly RuleBatch[],
	batchId: string,
) {
	const H = loaded.book.currency;
	const data = batches.flatMap((b) =>
		b.lines.map((l) => ({
			id: randomUUID(),
			bookId: loaded.row.id,
			month: b.month,
			fromEnvelopeId: l.amount < 0 ? l.envelopeId : null,
			toEnvelopeId: l.amount < 0 ? null : l.envelopeId,
			amount: fromMinor(Math.abs(l.amount), H).toString(),
			kind: "RULE" as const,
			batchId,
			sourceExpenseId: expenseId,
			ruleId: l.ruleId,
			actorUserId: userId,
		})),
	);
	if (data.length) await tx.budgetMovement.createMany({ data });
	return data.map((d) => d.id);
}

/** Σ per (rule, envelope), zero lines dropped. */
function addLines(a: readonly RuleLine[], b: readonly RuleLine[]): RuleLine[] {
	const sums = new Map<string, RuleLine>();
	for (const l of [...a, ...b]) {
		const k = `${l.ruleId}\u0000${l.envelopeId}`;
		const cur = sums.get(k);
		sums.set(k, { ...l, amount: (cur?.amount ?? 0) + l.amount });
	}
	return [...sums.values()].filter((l) => l.amount !== 0);
}

/** Rule lines to an archived envelope are left out: that money stays in To assign. */
function liveOnly(loaded: LoadedBook, batches: readonly RuleBatch[]) {
	const live = new Set(
		loaded.book.envelopes.filter((e) => !e.archived).map((e) => e.id),
	);
	return batches
		.map((b) => ({
			...b,
			lines: b.lines.filter((l) => live.has(l.envelopeId)),
		}))
		.filter((b) => b.lines.length > 0);
}

export interface RunInput {
	expenseId: string;
	row: IncomeRow | null;
	previous: RecordedRun | null;
	rules: readonly IncomeRule[];
	appliedToEarlier?: ReadonlySet<string>;
	batchId?: string;
}

/**
 * Plans and writes one row's run and stores its record. Null when nothing
 * was decided yet (a rate is missing), so the row is tried again later.
 */
export async function runOne(
	tx: Tx,
	loaded: LoadedBook,
	userId: string,
	p: RunInput,
): Promise<RuleRunDto | null> {
	const row = p.row ? moneyInRow(loaded, p.row) : null;
	if (row && isBudgetIncome(p.row as IncomeRow) && row.bookValue === null)
		return null;
	const plan = planRuleRun({
		row,
		rules: p.rules,
		previous: p.previous,
		currentMonth: loaded.input.currentMonth,
		appliedToEarlier: p.appliedToEarlier,
	});
	const base = plan.record ?? p.previous;
	if (!base) return null;
	const batches = liveOnly(loaded, plan.batches);
	const batchId = p.batchId ?? randomUUID();
	await writeBatches(
		tx,
		loaded,
		userId,
		p.row ? p.expenseId : null,
		batches,
		batchId,
	);
	// The net is what was written, so a revert never takes back more than went out.
	const net = addLines(
		p.previous?.net ?? [],
		batches.flatMap((b) => b.lines),
	);
	const standing = net.length > 0;
	const record = storeRecord({ ...base, net });
	const fingerprint = fingerprintOf(p.row);
	const batch = batches.length && standing ? batchId : null;
	await tx.incomeRuleRun.upsert({
		where: { expenseId: p.expenseId },
		create: {
			expenseId: p.expenseId,
			bookId: loaded.row.id,
			record,
			fingerprint,
			batchId: batch,
		},
		// Nothing written and still standing: the latest batch stays the row's.
		update: {
			record,
			fingerprint,
			...(batches.length || !standing ? { batchId: batch } : {}),
		},
	});
	const H = loaded.book.currency;
	return {
		expenseId: p.expenseId,
		batchId,
		lines: batches.flatMap((b) =>
			b.lines.map((l) => ({
				ruleId: l.ruleId,
				envelopeId: l.envelopeId,
				amount: { minor: l.amount, currency: H },
			})),
		),
	};
}

async function headOf(tx: Tx, userId: string): Promise<BookHead | null> {
	const b = await tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: {
			id: true,
			startDate: true,
			currency: true,
			defaultEnvelopeId: true,
		},
	});
	if (!b?.defaultEnvelopeId) return null;
	return { id: b.id, userId, startDate: b.startDate };
}

async function previousOf(tx: Tx, expenseId: string) {
	const run = await tx.incomeRuleRun.findUnique({ where: { expenseId } });
	return run ? loadRecord(run.record, run.skipped) : null;
}

/**
 * Runs the rules on every income row still waiting (sidecar rows, edits,
 * deletes): exactly once under the book lock. Cheap when nothing waits.
 */
export async function runPendingRules(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<RuleRunDto[]> {
	const b = await headOf(tx, userId);
	if (!b) return [];
	const book = await tx.budgetBook.findUniqueOrThrow({
		where: { id: b.id },
		select: { currency: true },
	});
	const quick = await pendingFor(
		tx,
		b,
		await activeRules(tx, b.id, book.currency),
	);
	if (quick.fresh.length === 0 && quick.changed.length === 0) return [];
	await lockBook(tx, b.id);
	// Again under the lock: a concurrent read may have run them.
	const rules = await activeRules(tx, b.id, book.currency);
	const work = await pendingFor(tx, b, rules);
	if (work.fresh.length === 0 && work.changed.length === 0) return [];
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) return [];
	const out: RuleRunDto[] = [];
	for (const row of work.fresh) {
		const run = await runOne(tx, loaded, userId, {
			expenseId: row.id,
			row,
			previous: null,
			rules,
		});
		if (run) out.push(run);
	}
	for (const c of work.changed) {
		const run = await runOne(tx, loaded, userId, {
			expenseId: c.expenseId,
			row: c.row,
			previous: await previousOf(tx, c.expenseId),
			rules,
		});
		if (run) out.push(run);
	}
	await freeze(tx, loaded.row.id, loaded.valuer);
	forgetMonthViews(tx);
	return out.filter((r) => r.lines.length > 0);
}

/**
 * The money-in service's hook: runs pending rules (this row among them) and
 * returns what they assigned from `expenseId`, so Use my plan plans only
 * the rest (SPEC §5.4: income rules run before auto-fill).
 */
export async function ruleTotalFor(
	tx: Tx,
	userId: string,
	expenseId: string,
	now: Date,
): Promise<number> {
	await runPendingRules(tx, userId, now);
	const run = await tx.incomeRuleRun.findUnique({ where: { expenseId } });
	if (!run || run.skipped) return 0;
	return loadRecord(run.record, false).net.reduce((s, l) => s + l.amount, 0);
}

/** Undoing a RULE batch marks its rows "rules skipped": they never run again (SPEC §5.10). */
export async function markRulesSkipped(
	tx: Tx,
	bookId: string,
	expenseIds: readonly string[],
) {
	if (expenseIds.length === 0) return;
	await tx.incomeRuleRun.updateMany({
		where: { bookId, expenseId: { in: [...expenseIds] } },
		data: { skipped: true, batchId: null },
	});
}

/** The user's book or a NO_BOOK error (rules need a budget). */
export async function requireBook(tx: Tx, userId: string) {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	return book;
}
