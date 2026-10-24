"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { AssignRows } from "./assign-rows";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useAssignDraft } from "./use-assign-draft";
import { useDryRun } from "./use-dry-run";
import { useMonth } from "./use-month";
import { useBudgetWrite } from "./use-write";

/**
 * Assign (payday, SPEC §6.4): money with no job goes to envelopes. The rows
 * start from the server's fill from targets (overspent envelopes first, then
 * what targets need); you change any amount, the counter and the changes
 * block show the server's dry run of the same write, and Save ends with an
 * Undo toast that takes the whole batch back.
 */
export function AssignSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.assign");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { refresh, saved, undoOf, money } = useBudgetWrite();
	const fill = api.envelope.fillFromTargets.useQuery(
		m.monthKey ? { month: m.monthKey } : {},
		{ enabled: m.data !== null },
	);
	const currency = m.data?.book.currency ?? "";
	const draft = useAssignDraft({
		currency,
		month: m.monthKey,
		lines: fill.data?.lines,
	});
	const previewMutation = api.envelope.assignPreview.useMutation();
	const commit = api.envelope.assign.useMutation();
	const dry = useDryRun(previewMutation.mutateAsync, draft.input);

	const groups = useMemo(() => {
		const funded = new Set(
			(fill.data?.lines ?? [])
				.filter((l) => l.amount.minor > 0)
				.map((l) => l.envelopeId),
		);
		const cover = m.envelopes.filter((e) => e.status === "OVERSPENT");
		const fund = m.envelopes.filter(
			(e) => e.status !== "OVERSPENT" && funded.has(e.id),
		);
		const other = m.envelopes.filter(
			(e) => e.status !== "OVERSPENT" && !funded.has(e.id),
		);
		const fromPlan = (fill.data?.lines ?? []).some((l) => l.step === "PLAN");
		return { cover, fund, other, fromPlan };
	}, [m.envelopes, fill.data]);

	const onSubmit = async () => {
		if (!draft.input) return false;
		const input = draft.input;
		const res = await commit.mutateAsync(input);
		await refresh();
		const delta = res.changes.find((c) => c.id === "budget.notPlannedYet");
		const amount = delta?.delta ?? null;
		saved(
			amount
				? t("toast", {
						amount: money({ minor: Math.abs(amount.minor), currency }),
						count: input.items.length,
					})
				: t("toastShort", { count: input.items.length }),
			undoOf({ batchId: input.batchId }),
		);
	};

	// The counter is the server's To assign after the write, once it is known.
	const counter =
		dry.preview?.value.toAssign.after ?? m.data?.toAssign.amount ?? null;
	const over = (dry.preview?.value.toAssign.after.minor ?? 0) < 0;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={dry.status !== "ready"}
			submitLabel={over ? t("assignAnyway") : t("assign")}
			title={t("title", { amount: money(m.data?.toAssign.amount ?? null) })}
			wide
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={5} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<div className="flex items-baseline justify-between gap-3">
						<span className="text-fg-2 text-small">{t("left", { pool })}</span>
						<Money
							className="text-section text-fg"
							figure="budget.notPlannedYet"
							value={counter}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button kind="secondary" onClick={draft.refill} size="sm">
							{t("fillTargets")}
						</Button>
						<Button kind="ghost" onClick={draft.clear} size="sm">
							{t("clear")}
						</Button>
					</div>
					<AssignRows
						{...groups}
						currency={currency}
						invalid={draft.invalid}
						onChange={draft.set}
						texts={draft.texts}
					/>
					<MovementChanges
						byId={m.byId}
						dry={dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
