/**
 * Income rules between the database and the pure allocator (rules.ts):
 * rule rows to rules and DTOs, inputs to columns, and the run record kept on
 * income_rule_run. The record never holds match text: the rules a first run
 * used matched then, and a rerun happens only when the money in itself
 * changes (SPEC §5.10), so a recorded rule is stored without its match.
 */
import { z } from "zod";
import type { RuleActionInput, RuleMatchInput } from "~/lib/schemas/envelope";
import type { IncomeRuleDto } from "~/lib/schemas/envelope-plan";
import { Prisma, type IncomeRule as RuleRow } from "~prisma";
import type { IncomeRule, RecordedRun, RuleAction, RuleMatch } from "./rules";
import { dec, fromMinor, toMinor } from "./units";

export function matchOf(r: RuleRow): RuleMatch {
	switch (r.matchKind) {
		case "CATEGORY":
			return { kind: "CATEGORY", categoryId: r.matchValue ?? "" };
		case "TEMPLATE":
			return { kind: "TEMPLATE", templateId: r.matchValue ?? "" };
		case "TITLE":
			return { kind: "TITLE", contains: r.matchTitle ?? "" };
		case "CURRENCY":
			return { kind: "CURRENCY", currency: r.matchValue ?? "" };
		default:
			return { kind: "ANY" };
	}
}

/** Percent 20.0 is 2000 basis points; an amount is book currency minor units. */
export function actionOf(r: RuleRow, H: string): RuleAction {
	if (r.action === "PERCENT")
		return {
			kind: "PERCENT",
			basisPoints: dec(r.value ?? "0")
				.times(100)
				.toNumber(),
		};
	if (r.action === "AMOUNT")
		return { kind: "AMOUNT", minor: toMinor(r.value ?? "0", H) };
	return { kind: "REMAINDER" };
}

export function toRule(r: RuleRow, H: string): IncomeRule {
	return {
		id: r.id,
		sortOrder: r.sortOrder,
		envelopeId: r.envelopeId,
		active: r.active && r.archivedAt === null,
		createdAtMs: r.createdAt.getTime(),
		match: matchOf(r),
		action: actionOf(r, H),
	};
}

export function toRuleDto(r: RuleRow, H: string): IncomeRuleDto {
	const a = actionOf(r, H);
	return {
		id: r.id,
		name: r.name,
		sortOrder: r.sortOrder,
		match: matchOf(r),
		action: {
			kind: a.kind,
			basisPoints: a.kind === "PERCENT" ? a.basisPoints : null,
			amount: a.kind === "AMOUNT" ? { minor: a.minor, currency: H } : null,
		},
		envelopeId: r.envelopeId,
		active: r.active,
		createdAt: r.createdAt,
	};
}

/** Columns for a rule's match and action. */
export function ruleColumns(
	m: RuleMatchInput | undefined,
	a: RuleActionInput | undefined,
	H: string,
) {
	const match = m
		? {
				matchKind: m.kind,
				matchValue:
					m.kind === "CATEGORY"
						? m.categoryId
						: m.kind === "TEMPLATE"
							? m.templateId
							: m.kind === "CURRENCY"
								? m.currency
								: null,
				matchTitle: m.kind === "TITLE" ? m.contains : null,
			}
		: {};
	const action = a
		? {
				action: a.kind,
				value:
					a.kind === "PERCENT"
						? new Prisma.Decimal(a.basisPoints).dividedBy(100)
						: a.kind === "AMOUNT"
							? new Prisma.Decimal(fromMinor(a.amountMinor, H).toString())
							: null,
			}
		: {};
	return { ...match, ...action };
}

const lineSchema = z.object({
	ruleId: z.string(),
	envelopeId: z.string(),
	amount: z.number().int(),
});

const recordSchema = z.object({
	rules: z.array(
		z.object({
			id: z.string(),
			sortOrder: z.number().int(),
			envelopeId: z.string(),
			action: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("PERCENT"), basisPoints: z.number().int() }),
				z.object({ kind: z.literal("AMOUNT"), minor: z.number().int() }),
				z.object({ kind: z.literal("REMAINDER") }),
			]),
		}),
	),
	bookValue: z.number().int().nullable(),
	rowMonth: z.number().int(),
	batchMonth: z.number().int(),
	net: z.array(lineSchema),
	skipped: z.boolean(),
});

/** What income_rule_run.record stores: ids, order, envelopes, actions and amounts only. */
export function storeRecord(r: RecordedRun): Prisma.InputJsonValue {
	return {
		rules: r.rules.map((x) => ({
			id: x.id,
			sortOrder: x.sortOrder,
			envelopeId: x.envelopeId,
			action: x.action,
		})),
		bookValue: r.bookValue,
		rowMonth: r.rowMonth,
		batchMonth: r.batchMonth,
		net: r.net.map((l) => ({ ...l })),
		skipped: r.skipped,
	};
}

/** A stored record as the allocator reads it: every recorded rule matched on the first run. */
export function loadRecord(json: unknown, skipped: boolean): RecordedRun {
	const r = recordSchema.parse(json);
	return {
		...r,
		skipped: skipped || r.skipped,
		rules: r.rules.map((x) => ({
			...x,
			active: true,
			createdAtMs: 0,
			match: { kind: "ANY" as const },
		})),
	};
}

export interface IncomeRowFields {
	id: string;
	amount: Prisma.Decimal;
	currency: string;
	date: Date;
	direction: "IN" | "OUT";
	entryKind: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
	inType: "INCOME" | "REFUND" | null;
	keepInWealth: boolean;
	status: string;
}

/** Budget income: money in that enters To assign (SPEC §12.3). */
export function isBudgetIncome(r: IncomeRowFields): boolean {
	return (
		r.direction === "IN" &&
		r.entryKind === "STANDARD" &&
		r.inType === "INCOME" &&
		!r.keepInWealth &&
		r.status === "FINALIZED"
	);
}

/** What a rerun watches: amount, currency, date and whether it is budget income (SPEC §5.10 Reruns). */
export function fingerprintOf(r: IncomeRowFields | null): string {
	if (!r) return "deleted";
	return [
		r.amount.toString(),
		r.currency,
		r.date.toISOString(),
		isBudgetIncome(r) ? "in" : "out",
	].join("|");
}
