/**
 * Display helpers for payment groups (see settlement-groups.ts on the
 * server): one history entry per payment, with its per-project parts and
 * offsets, and the settle-up dialog's other-currency hints.
 */

export interface SettlementPartView {
	projectId: string | null;
	projectName: string | null;
	currency: string;
	amount: number;
	isOffset: boolean;
	/** From the viewer's side: "outgoing" = the viewer pays on this row. */
	direction: "outgoing" | "incoming";
}

export interface SettlementEntryView {
	kind: "payment" | "square_up";
	amount: number;
	currency: string;
	cashByCurrency: Array<{ currency: string; amount: number }>;
	offsetByCurrency: Array<{ currency: string; amount: number }>;
	parts: SettlementPartView[];
}

type Format = (amount: number, currency: string) => string;
type Translate = (
	key: string,
	values?: Record<string, string | number>,
) => string;

/** Amounts below this are treated as nothing (rounding dust). */
const DUST = 0.005;

function scopeLabel(part: SettlementPartView, t: Translate): string {
	if (part.projectId === null) return t("standaloneScope");
	return part.projectName ?? t("unknownProject");
}

function uniqueLabels(parts: SettlementPartView[], t: Translate): string {
	return [...new Set(parts.map((p) => scopeLabel(p, t)))].join(", ");
}

/**
 * The muted second line of a payment in the People view:
 * - offsets: "Paid 20, offset 30: Trip against Rent"
 * - square-up: "Offset 30: Trip against Rent"
 * - a payment split over several projects: "Trip 60 · Rent 40"
 * - a payment in one scope: nothing.
 */
export function settlementDetail(
	entry: SettlementEntryView,
	format: Format,
	t: Translate,
): string | null {
	const offsets = entry.parts.filter((p) => p.isOffset);
	const cash = entry.parts.filter((p) => !p.isOffset);

	if (entry.kind === "square_up" || offsets.length > 0) {
		// Offsets come in pairs: the side going the way of the cash (the
		// payer's debts) against the side going back (the payee's debts).
		const lead = cash[0]?.direction ?? "outgoing";
		const values = {
			offset: entry.offsetByCurrency
				.map((o) => format(o.amount, o.currency))
				.join(", "),
			from: uniqueLabels(
				offsets.filter((p) => p.direction === lead),
				t,
			),
			against: uniqueLabels(
				offsets.filter((p) => p.direction !== lead),
				t,
			),
		};
		return entry.kind === "square_up"
			? t("settlementSquareUpDetail", values)
			: t("settlementOffsetDetail", {
					...values,
					paid: format(entry.amount, entry.currency),
				});
	}

	const scopes = new Set(cash.map((p) => p.projectId));
	if (scopes.size < 2) return null;
	return cash
		.map((p) => `${scopeLabel(p, t)} ${format(p.amount, p.currency)}`)
		.join(" · ");
}

/**
 * The part of a payment that belongs to one project scope, for views
 * filtered to that project: one entry per currency, with the net amount for
 * the scope (cash plus offsets, from the viewer's side) and a label that
 * says it is part of a larger payment.
 */
export function settlementProjectParts(
	entry: SettlementEntryView,
	projectId: string | null,
	format: Format,
	t: Translate,
): Array<{
	amount: number;
	currency: string;
	direction: "outgoing" | "incoming";
	detail: string | null;
}> {
	const inScope = entry.parts.filter((p) => p.projectId === projectId);
	const currencies = [...new Set(inScope.map((p) => p.currency))];

	return currencies.map((currency) => {
		const parts = inScope.filter((p) => p.currency === currency);
		const signed = parts.reduce(
			(sum, p) => sum + (p.direction === "incoming" ? p.amount : -p.amount),
			0,
		);
		const cash = parts
			.filter((p) => !p.isOffset)
			.reduce((sum, p) => sum + p.amount, 0);
		const offset = parts
			.filter((p) => p.isOffset)
			.reduce((sum, p) => sum + p.amount, 0);
		const total =
			entry.cashByCurrency.find((c) => c.currency === currency)?.amount ?? 0;

		let detail: string | null;
		if (entry.kind === "square_up") {
			detail = t("settlementPartSquareUp");
		} else {
			const pieces: string[] = [];
			if (cash > DUST && total > cash + DUST) {
				pieces.push(
					t("settlementPartOf", {
						part: format(cash, currency),
						total: format(total, currency),
					}),
				);
			}
			if (offset > DUST) {
				pieces.push(
					t("settlementPartOffset", { offset: format(offset, currency) }),
				);
			}
			detail = pieces.length > 0 ? pieces.join(", ") : null;
		}

		return {
			amount: Math.abs(signed),
			currency,
			direction: signed >= 0 ? ("incoming" as const) : ("outgoing" as const),
			detail,
		};
	});
}

/**
 * Balances in other currencies that go the opposite way of the one being
 * settled. A settle-up never nets across currencies, so the dialog only
 * mentions them ("Bob also owes you 30,000 ARS").
 */
export function oppositeCurrencyBalances<
	T extends { currency: string; direction: string },
>(plans: T[], selected: { currency: string; direction: string }): T[] {
	if (selected.direction === "settled") return [];
	return plans.filter(
		(p) =>
			p.currency !== selected.currency &&
			p.direction !== "settled" &&
			p.direction !== selected.direction,
	);
}

/**
 * Toast options for a failed settle-up: money received that matches a
 * pending claim comes back as a CONFLICT naming it, and the toast offers to
 * record it as a different payment (`retry`). Anything else: no action.
 */
export function claimConflictAction(
	error: { data?: { code?: string } | null },
	label: string,
	retry: () => void,
): { action: { label: string; onClick: () => void } } | undefined {
	if (error.data?.code !== "CONFLICT") return undefined;
	return { action: { label, onClick: retry } };
}
