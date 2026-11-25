"use client";

import type { HolderId } from "@retrospend/domain/category-merge/holders";
import { useTranslations } from "next-intl";
import { ChangeRow, ChangeValue } from "~/components/ui/sheet-changes";
import type { RouterOutputs } from "~/trpc/react";

type Removed = RouterOutputs["categories"]["previewRemove"]["value"];

/** The holders that name their own rows in the sheet, in the order they read. */
const ROWS: readonly HolderId[] = [
	"expense",
	"template",
	"sharedTransaction",
	"share",
	"incomeRule",
	"draft",
];

/**
 * What the server's dry run says it moves, as the lines of "What this
 * changes": the category going, each kind of row that moves with where it
 * goes, what is dropped (budgets), shares set to no category, and every
 * envelope the rows end up in. The counts and envelopes are the answer's, laid
 * out; nothing is added up or decided here. `envelopeName` names an envelope
 * of a book, or null when the sheet cannot (another book).
 */
export function RemoveLines({
	value,
	name,
	targetName,
	envelopeName,
}: {
	value: Removed;
	/** The category going, as people see it. */
	name: string;
	/** Where its rows go, null for a delete. */
	targetName: string | null;
	envelopeName: (bookId: string, envelopeId: string) => string | null;
}) {
	const t = useTranslations("settingsV2.categories.remove");
	const to = targetName ?? t("none");
	return (
		<>
			<ChangeRow label={t("category")}>
				<ChangeValue from={name} to={t("deleted")} />
			</ChangeRow>
			{ROWS.map((id) => {
				const moved = value.counts[id].moved;
				if (moved === 0) return null;
				return (
					<ChangeRow key={id} label={t(`rows.${id}`)}>
						<ChangeValue from={t("count", { count: moved })} to={to} />
					</ChangeRow>
				);
			})}
			{value.setToNone > 0 ? (
				<ChangeRow label={t("rows.sharedLocked")}>
					<ChangeValue
						from={t("count", { count: value.setToNone })}
						to={t("none")}
					/>
				</ChangeRow>
			) : null}
			{value.counts.budget.moved > 0 ? (
				<ChangeRow label={t("rows.budget")}>
					<ChangeValue
						from={t("count", { count: value.counts.budget.moved })}
						to={to}
					/>
				</ChangeRow>
			) : null}
			{value.counts.budget.dropped > 0 ? (
				<ChangeRow label={t("rows.budgetRemoved")}>
					<span>{t("count", { count: value.counts.budget.dropped })}</span>
				</ChangeRow>
			) : null}
			{value.rerouted.map((r) => (
				<ChangeRow
					key={`${r.bookId}-${r.rows}-${r.from}-${r.to}`}
					label={t("reroute", { name: r.rows === "source" ? name : to })}
				>
					<ChangeValue
						from={envelopeName(r.bookId, r.from) ?? t("otherEnvelope")}
						to={envelopeName(r.bookId, r.to) ?? t("otherEnvelope")}
					/>
				</ChangeRow>
			))}
		</>
	);
}
