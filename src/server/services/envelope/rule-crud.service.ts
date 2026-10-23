/**
 * The Rules list (SPEC §5.10, §6.10): add, edit, reorder, pause and remove,
 * and "Also apply to this month's money in". Editing the list moves no
 * money: rules see money in created after them, and a past batch keeps the
 * rules it ran with. Applying a rule to this month's money in does move
 * money, so it runs as a previewed mutation (rule.mutation.ts).
 */

import type { RuleMatchInput } from "~/lib/schemas/envelope";
import type {
	ApplyRuleResult,
	ApplyRuleToMonthInput,
	CreateRuleInput,
	IncomeRuleDto,
	UpdateRuleInput,
} from "~/lib/schemas/envelope-plan";
import type { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import { monthRange } from "./months";
import { result } from "./movement.service";
import { lockedSnapshot } from "./movement-state";
import {
	type IncomeRow,
	moneyInRow,
	ROW_SELECT,
	requireBook,
	runOne,
	runPendingRules,
} from "./rule.service";
import { loadRecord, ruleColumns, toRule, toRuleDto } from "./rule-store";
import { ruleMatches } from "./rules";

type Tx = Prisma.TransactionClient;
type Book = Awaited<ReturnType<typeof requireBook>>;

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

export async function listRules(
	tx: Tx,
	userId: string,
): Promise<IncomeRuleDto[]> {
	const book = await requireBook(tx, userId);
	const rows = await tx.incomeRule.findMany({
		where: { bookId: book.id, archivedAt: null },
		orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
	});
	return rows.map((r) => toRuleDto(r, book.currency));
}

async function checkTargets(
	tx: Tx,
	book: Book,
	envelopeId: string | undefined,
	match: RuleMatchInput | undefined,
) {
	if (envelopeId) {
		const e = book.envelopes.find((x) => x.id === envelopeId);
		if (!e) throw new EnvelopeError("NOT_FOUND", "no such envelope");
		if (e.archivedAt) invalid("that envelope is archived");
	}
	if (match?.kind === "CATEGORY") {
		// RLS shows only the user's own categories.
		const ok = await tx.category.count({
			where: { id: match.categoryId, kind: "INCOME" },
		});
		if (!ok) invalid("pick one of your income categories");
	}
	if (match?.kind === "TEMPLATE") {
		const ok = await tx.recurringTemplate.count({
			where: { id: match.templateId, direction: "IN" },
		});
		if (!ok) invalid("pick one of your recurring money in");
	}
}

export async function createRule(
	tx: Tx,
	userId: string,
	input: CreateRuleInput,
	now: Date,
): Promise<IncomeRuleDto> {
	const book = await requireBook(tx, userId);
	const existing = await tx.incomeRule.findUnique({ where: { id: input.id } });
	if (existing) {
		if (existing.bookId !== book.id || existing.name !== input.name)
			throw new EnvelopeError("ID_REUSED", "that id was already used");
		return toRuleDto(existing, book.currency);
	}
	await checkTargets(tx, book, input.envelopeId, input.match);
	const last = await tx.incomeRule.aggregate({
		where: { bookId: book.id },
		_max: { sortOrder: true },
	});
	const row = await tx.incomeRule.create({
		data: {
			id: input.id,
			bookId: book.id,
			name: input.name,
			sortOrder: (last._max.sortOrder ?? -1) + 1,
			envelopeId: input.envelopeId,
			createdAt: now,
			...ruleColumns(input.match, input.action, book.currency),
		} as Prisma.IncomeRuleUncheckedCreateInput,
	});
	return toRuleDto(row, book.currency);
}

async function ownRule(tx: Tx, book: Book, id: string) {
	const rule = await tx.incomeRule.findFirst({
		where: { id, bookId: book.id, archivedAt: null },
	});
	if (!rule) throw new EnvelopeError("NOT_FOUND", "no such rule");
	return rule;
}

export async function updateRule(
	tx: Tx,
	userId: string,
	input: UpdateRuleInput,
): Promise<IncomeRuleDto> {
	const book = await requireBook(tx, userId);
	await ownRule(tx, book, input.id);
	await checkTargets(tx, book, input.envelopeId, input.match);
	const row = await tx.incomeRule.update({
		where: { id: input.id },
		data: {
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
			...(input.active !== undefined ? { active: input.active } : {}),
			...ruleColumns(input.match, input.action, book.currency),
		} as Prisma.IncomeRuleUncheckedUpdateInput,
	});
	return toRuleDto(row, book.currency);
}

/** The new order for every listed rule; rules left out keep theirs after them. */
export async function reorderRules(
	tx: Tx,
	userId: string,
	ids: readonly string[],
): Promise<IncomeRuleDto[]> {
	const book = await requireBook(tx, userId);
	const rules = await tx.incomeRule.findMany({
		where: { bookId: book.id, archivedAt: null },
		orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
	});
	const known = new Set(rules.map((r) => r.id));
	if (ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length)
		invalid("reorder names each of your rules once");
	const order = [
		...ids,
		...rules.map((r) => r.id).filter((id) => !ids.includes(id)),
	];
	for (const [i, id] of order.entries())
		await tx.incomeRule.update({ where: { id }, data: { sortOrder: i } });
	return listRules(tx, userId);
}

/** Removes a rule from the list; its row stays so history can name it. */
export async function archiveRule(
	tx: Tx,
	userId: string,
	id: string,
	now: Date,
): Promise<IncomeRuleDto> {
	const book = await requireBook(tx, userId);
	await ownRule(tx, book, id);
	const row = await tx.incomeRule.update({
		where: { id },
		data: { archivedAt: now, active: false },
	});
	return toRuleDto(row, book.currency);
}

/** This month's budget income created before the rule: the rows "Also apply" reaches. */
async function thisMonthEarlierRows(
	tx: Tx,
	userId: string,
	s: Awaited<ReturnType<typeof lockedSnapshot>>,
	before: Date,
): Promise<IncomeRow[]> {
	const c = s.current;
	const range = monthRange(c, s.loaded.periods);
	const rows = await tx.expense.findMany({
		where: {
			userId,
			direction: "IN",
			entryKind: "STANDARD",
			inType: "INCOME",
			keepInWealth: false,
			status: "FINALIZED",
			createdAt: { lte: before },
			date: {
				gte: new Date(
					new Date(`${range.from}T00:00:00Z`).getTime() - 2 * 86_400_000,
				),
				lte: new Date(
					new Date(`${range.to}T00:00:00Z`).getTime() + 2 * 86_400_000,
				),
			},
		},
		select: ROW_SELECT,
		orderBy: [{ date: "asc" }, { id: "asc" }],
	});
	return rows.filter(
		(r) =>
			r.date >= s.loaded.row.startDate &&
			s.loaded.valuer.dated(r.date).month === c,
	);
}

/**
 * "Also apply to this month's money in" (SPEC §5.10): the rule runs on this
 * month's income created before it, as one batch. A row that already ran
 * other rules reruns with those plus this one (a remainder rule gives up
 * what this one takes); a row whose rules were skipped is left alone.
 */
export async function applyRuleToMonth(
	tx: Tx,
	userId: string,
	input: ApplyRuleToMonthInput,
	now: Date,
): Promise<ApplyRuleResult> {
	await runPendingRules(tx, userId, now);
	const s = await lockedSnapshot(tx, userId, now);
	const again = await tx.budgetMovement.findMany({
		where: { bookId: s.loaded.row.id, batchId: input.batchId },
		select: { id: true },
	});
	if (again.length)
		return {
			runs: [],
			movement: await result(
				tx,
				userId,
				now,
				s,
				again.map((m) => m.id),
			),
		};
	const ruleRow = await tx.incomeRule.findFirst({
		where: { id: input.ruleId, bookId: s.loaded.row.id, archivedAt: null },
	});
	if (!ruleRow) throw new EnvelopeError("NOT_FOUND", "no such rule");
	if (!ruleRow.active) invalid("resume the rule first");
	const rule = toRule(ruleRow, s.loaded.book.currency);
	const runs = [];
	for (const row of await thisMonthEarlierRows(
		tx,
		userId,
		s,
		ruleRow.createdAt,
	)) {
		const stored = await tx.incomeRuleRun.findUnique({
			where: { expenseId: row.id },
		});
		const prev = stored ? loadRecord(stored.record, stored.skipped) : null;
		if (prev?.skipped || prev?.rules.some((r) => r.id === rule.id)) continue;
		// A recorded run reruns without matching again, so the new rule must match now.
		if (prev && !ruleMatches(rule.match, moneyInRow(s.loaded, row))) continue;
		const run = await runOne(tx, s.loaded, userId, {
			expenseId: row.id,
			row,
			previous: prev
				? {
						...prev,
						rules: [
							...prev.rules,
							{ ...rule, match: { kind: "ANY" as const } },
						].sort(
							(a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1),
						),
					}
				: null,
			rules: prev ? [] : [rule],
			appliedToEarlier: new Set([rule.id]),
			batchId: input.batchId,
		});
		if (run && run.lines.length) runs.push(run);
	}
	forgetMonthViews(tx);
	const ids = await tx.budgetMovement.findMany({
		where: { bookId: s.loaded.row.id, batchId: input.batchId },
		select: { id: true },
	});
	return {
		runs,
		movement: ids.length
			? await result(
					tx,
					userId,
					now,
					s,
					ids.map((m) => m.id),
				)
			: null,
	};
}
