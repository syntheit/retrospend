"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";
import { newId, useBudgetWrite } from "./use-write";

/**
 * Fund next month now (SPEC §5.13): a saved plan is a draft until payday;
 * this is the separate, previewed step that takes next month's plan out of
 * what this month has not planned yet. The server shows every envelope it
 * fills before Save, and Undo (the draft's own inverse) puts it back.
 */
export function FundNowSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.fundNow");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const name = useMonthName();
	const { undoOf } = useBudgetWrite();
	const [batchId] = useState(newId);
	// Next month, as the page shows it: the plan being edited, else the saved one.
	const next = m.monthKey
		? m.monthKey % 100 === 12
			? m.monthKey + 89
			: m.monthKey + 1
		: undefined;
	const drafts = api.envelope.drafts.useQuery(
		{ kind: "PLAN", ...(next ? { month: next } : {}) },
		{ enabled: !!next },
	);
	const draftId = drafts.data?.open?.id ?? drafts.data?.saved?.id ?? null;
	const draft = api.envelope.previewDraft.useQuery(
		{ draftId: draftId ?? "" },
		{ enabled: !!draftId },
	);
	const preview = api.envelope.fundPlanNowPreview.useMutation();
	const commit = api.envelope.fundPlanNow.useMutation();
	const nextName = draft.data ? name(draft.data.month) : "";
	const w = useMoneyWrite({
		input: draft.data && draftId ? { draftId, batchId } : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { next: nextName }),
		undo: (_r, i) => undoOf({ batchId: i.batchId }),
	});
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("fund", { next: nextName })}
			title={t("title", { next: nextName })}
		>
			{m.loading || !m.data || drafts.isLoading ? (
				<SkeletonRows count={3} />
			) : !draftId ? (
				<p className="text-fg-2 text-small">{t("noPlan")}</p>
			) : !draft.data ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t("lead", { next: nextName })}
					</p>
					<MovementChanges
						byId={m.byId}
						dry={w.dry}
						fallbackName={t("envelopeFallback")}
						moved={(p) => p.value.movement?.envelopes ?? []}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
