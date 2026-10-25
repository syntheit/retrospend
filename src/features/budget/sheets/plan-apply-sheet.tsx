"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { EnvelopeTile } from "./envelope-tile";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";

/**
 * Apply the plan for the month on screen (SPEC §5.13, B4): the draft becomes
 * the saved plan that funds itself when that month's money arrives. The
 * month in use does not change and nothing moves; the server previews that
 * and Undo puts the draft back as it was. Every planned line is listed
 * first. "Fund it now" is its own step.
 */
export function PlanApplySheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.planApply");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const name = useMonthName();
	const drafts = api.envelope.drafts.useQuery(
		{ kind: "PLAN", ...(m.monthKey ? { month: m.monthKey } : {}) },
		{ enabled: m.monthKey !== null },
	);
	const draft = drafts.data?.open ?? null;
	const preview = api.envelope.applyDraftPreview.useMutation();
	const commit = api.envelope.applyDraft.useMutation();
	const unapply = api.envelope.unapplyDraft.useMutation();
	const monthName = m.monthKey ? name(m.monthKey) : "";
	const w = useMoneyWrite({
		input: draft ? { draftId: draft.id } : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { month: monthName }),
		undo: (_r, i) => () => unapply.mutateAsync({ draftId: i.draftId }),
	});
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("apply")}
			title={t("title", { month: monthName })}
		>
			{m.loading || drafts.isLoading || !m.data ? (
				<SkeletonRows count={4} />
			) : !draft ? (
				<p className="text-fg-2 text-small">{t("none")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t("lead", { month: monthName })}
					</p>
					<RowList label={t("lines")} variant="flat">
						{draft.lines
							.filter((l) => l.amountMinor > 0)
							.map((l) => {
								const e = m.byId.get(l.envelopeId);
								return (
									<Row
										end={
											<Money
												value={{
													minor: l.amountMinor,
													currency: m.data?.book.currency ?? "",
												}}
											/>
										}
										key={l.envelopeId}
										lead={e ? <EnvelopeTile envelope={e} /> : undefined}
										sub={
											e?.groupName ? (
												<RowSub parts={[e.groupName]} />
											) : undefined
										}
										title={e?.name ?? t("envelopeFallback")}
									/>
								);
							})}
					</RowList>
					<FigureChanges dry={w.dry} poolName={pool} />
				</div>
			)}
		</Sheet>
	);
}
