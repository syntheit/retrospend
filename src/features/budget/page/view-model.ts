/**
 * The Budget page's view models. Every number is the server's (R9): this
 * file only picks which rows show, in what state, and under which words.
 * It compares and filters; it never adds, subtracts or divides money.
 */
import type { EnvelopeVM } from "~/components/rows/types";
import type {
	EnvelopeGroupDto,
	EnvelopeRowDto,
	GetMonthOutput,
} from "~/lib/schemas/envelope";
import { categoryTone } from "~/server/services/expense-list/category-tone";

export type BudgetStyle = GetMonthOutput["book"]["style"];
export type Status = EnvelopeRowDto["status"];

const AVAILABLE: Record<Status, EnvelopeVM["status"]> = {
	OVERSPENT: "overspent",
	UNDERFUNDED: "underfunded",
	FUNDED: "funded",
	NO_TARGET: "funded",
};

/** The kit's row model for an envelope: its Left, and the server's share spent for the bar. */
export function toEnvelopeVM(e: EnvelopeRowDto): EnvelopeVM {
	return {
		id: e.id,
		name: e.name,
		category: {
			name: e.name,
			icon: e.icon,
			tone: categoryTone(e.color ?? "slate"),
		},
		available: e.left,
		status: AVAILABLE[e.status],
		spent: e.spentBasis ?? undefined,
		figure: `envelope.left:${e.id}`,
	};
}

/** A debt is in the book: a bill follows a liability, or the style is Pay off debt. */
export function hasDebt(data: GetMonthOutput): boolean {
	return (
		data.book.style === "DEBT_PAYOFF" ||
		data.groups.some((g) => g.envelopes.some((e) => e.target?.liabilityId))
	);
}

/** Limits books name their columns Limit, Spent, Left (SPEC §6.1). */
export function isLimits(style: BudgetStyle): boolean {
	return style === "LIMITS";
}

/** Every dollar and 50/30/20 show every envelope; Flex and Save first fold each group to one row. */
export function groupStartsOpen(
	style: BudgetStyle,
	group: EnvelopeGroupDto,
): boolean {
	switch (style) {
		case "FLEX":
		case "SAVE_FIRST":
			return false;
		case "WEEKLY":
			return group.role === "SPENDING";
		default:
			return true;
	}
}

export type Chip = "overspent" | "underfunded";

export type RowFilter = { query: string; chip: Chip | null };

const CHIP_STATUS: Record<Chip, Status> = {
	overspent: "OVERSPENT",
	underfunded: "UNDERFUNDED",
};

/** Search by name, and one status chip. Both narrow the list only. */
export function matches(e: EnvelopeRowDto, f: RowFilter): boolean {
	if (f.chip && e.status !== CHIP_STATUS[f.chip]) return false;
	const q = f.query.trim().toLowerCase();
	return q === "" || e.name.toLowerCase().includes(q);
}

export function isFiltered(f: RowFilter): boolean {
	return f.chip !== null || f.query.trim() !== "";
}

/** How many envelopes carry a status, for the chip counts. */
export function countStatus(
	groups: readonly EnvelopeGroupDto[],
	chip: Chip,
): number {
	let n = 0;
	for (const g of groups)
		for (const e of g.envelopes) if (e.status === CHIP_STATUS[chip]) n++;
	return n;
}

/** Groups with only the envelopes that match; a group left empty is dropped while filtering. */
export function filterGroups(
	groups: readonly EnvelopeGroupDto[],
	f: RowFilter,
): EnvelopeGroupDto[] {
	if (!isFiltered(f)) return [...groups];
	return groups
		.map((g) => ({ ...g, envelopes: g.envelopes.filter((e) => matches(e, f)) }))
		.filter((g) => g.envelopes.length > 0);
}

/** The envelopes that are over, in the order the page lists them. */
export function overEnvelopes(g: EnvelopeGroupDto): EnvelopeRowDto[] {
	return g.envelopes.filter((e) => e.status === "OVERSPENT");
}

/** A group's own key: its id, or "none" for envelopes without one. */
export function groupKey(g: EnvelopeGroupDto): string {
	return g.id ?? "none";
}

/** An envelope's name by id, for the verdict's names. */
export function namesById(
	groups: readonly EnvelopeGroupDto[],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const g of groups) for (const e of g.envelopes) out.set(e.id, e.name);
	return out;
}

/** The one notice the page shows, and what its button does. */
export type PageNotice =
	| { kind: "welcomeBack" }
	| { kind: "summary"; month: number }
	| { kind: "notPlanned" }
	| { kind: "overspent"; count: number; name: string | null };

type WelcomeBack = {
	pending: boolean;
	months: ReadonlyArray<{ month: number; acknowledged: boolean }>;
} | null;

/**
 * At most one notice (R14, SYNTHESIS-r6 §4): coming back after time away
 * first, then a closed month nobody has read, then the verdict's own.
 */
export function pickNotice(
	data: GetMonthOutput,
	welcome: WelcomeBack | undefined,
	names: ReadonlyMap<string, string>,
): PageNotice | null {
	if (welcome?.pending) return { kind: "welcomeBack" };
	const unread = welcome?.months.find((m) => !m.acknowledged);
	if (unread) return { kind: "summary", month: unread.month };
	const n = data.verdict.notice;
	if (!n) return null;
	if (n.kind === "NOT_PLANNED_YET") return { kind: "notPlanned" };
	const over = data.verdict.overEnvelopes;
	return {
		kind: "overspent",
		count: over.length,
		name: over.length === 1 ? (names.get(over[0]?.id ?? "") ?? null) : null,
	};
}
