"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import {
	type ChangeLine,
	ChangeValue,
	SheetChanges,
} from "~/components/ui/sheet-changes";
import type { DryRun } from "./use-dry-run";

type Amount = { minor: number; currency: string };

/** The part of a server preview every money write shares (R30). */
export type Diff = {
	changes: readonly {
		id: string;
		currency: string;
		before: Amount | null;
		after: Amount | null;
	}[];
	unchanged: readonly { id: string }[];
	unavailable: readonly { id: string; before?: unknown; after?: unknown }[];
};

/** A figure id as a translation key: "budget.leftToSpend" is "budget_leftToSpend". */
const keyOf = (id: string) => id.replace(/\./g, "_");

/** Figures only some styles have: null on both sides means not applicable here, not unknown. */
const STYLE_ONLY = new Set(["budget.leftInLimits", "budget.leftThisWeek"]);

/** Figures the sheet's own lines already name; they are not repeated. */
const OWN = new Set(["envelope.left"]);

/**
 * The "What this changes" block of a Budget money sheet (R30, kit
 * SheetChanges): the server's dry run of the same write Save makes. The
 * sheet's own lines (the envelopes that move) come first, then the budget
 * figures that moved, then what was checked and stays. Nothing here adds,
 * converts or rounds; it lays out what the server said.
 *
 * `poolName` names the To assign pool in the book's style ("Not planned
 * yet" outside Every dollar).
 */
export function FigureChanges<P extends Diff>({
	dry,
	own,
	poolName,
	done = false,
	idle,
	hide = [],
	envelopeName,
}: {
	dry: DryRun<P>;
	/** Lines for what the write moved besides the figures, from the preview. */
	own?: (preview: P) => ChangeLine[];
	poolName?: string;
	done?: boolean;
	/** What to say while there is nothing to preview yet. */
	idle?: ReactNode;
	/** Figure ids this sheet leaves out of the block. */
	hide?: readonly string[];
	/** One envelope this write moves with no per-envelope result: its Left line shows under this name. */
	envelopeName?: string;
}) {
	const t = useTranslations("budgetSheets.changes");
	const label = useFigureLabel(poolName);
	if (dry.status === "idle") return <SheetChanges status={idle ?? t("idle")} />;
	if (dry.status === "error") return <SheetChanges status={t("cannot")} />;
	const p = dry.preview;
	if (!p) return <SheetChanges status={t("loading")} />;
	const skip = new Set([...(envelopeName ? [] : OWN), ...hide]);
	const lines: ChangeLine[] = [
		...(own ? own(p) : []),
		...p.changes
			.filter((c) => !skip.has(c.id))
			.map((c) => ({
				key: `${c.id}-${c.currency}`,
				label:
					c.id === "envelope.left" && envelopeName
						? envelopeName
						: label(c.id).name,
				value: (
					<ChangeValue
						from={
							c.before ? (
								<Money figure={c.id} value={c.before} />
							) : (
								<span>{t("notAvailable")}</span>
							)
						}
						to={
							c.after ? (
								<Money figure={c.id} value={c.after} />
							) : (
								<span>{t("notAvailable")}</span>
							)
						}
					/>
				),
			})),
	];
	return (
		<div aria-busy={dry.status === "loading"}>
			<SheetChanges
				done={done}
				lines={lines}
				stays={p.unchanged
					.filter((u) => !skip.has(u.id))
					.map((u) => label(u.id).inline)}
				unavailable={p.unavailable
					// A figure that reads null on both sides does not apply to this book
					// (Left in your limits outside Limits): not applicable, not unknown.
					.filter(
						(u) =>
							!(STYLE_ONLY.has(u.id) && u.before == null && u.after == null),
					)
					.filter((u) => !skip.has(u.id))
					.map((u) => label(u.id).inline)}
			/>
		</div>
	);
}

/** Names for the figures a Budget write can move or check, in both readings. */
export function useFigureLabel(poolName?: string) {
	const t = useTranslations("budgetSheets.figures");
	const inline = useTranslations("budgetSheets.figuresInline");
	return (id: string): { name: string; inline: string } => {
		const key = keyOf(id);
		if (key === "budget_notPlannedYet" && poolName)
			return { name: poolName, inline: poolName };
		return t.has(key)
			? { name: t(key), inline: inline(key) }
			: { name: t("other"), inline: inline("other") };
	};
}
