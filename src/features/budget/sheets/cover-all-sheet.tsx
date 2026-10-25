"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api, type RouterInputs } from "~/trpc/react";
import { EnvelopeTile } from "./envelope-tile";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type AssignInput = RouterInputs["envelope"]["assign"];

/**
 * Cover every overspent envelope (SPEC §6.5): the server's fill from targets
 * puts the overspent envelopes first, each with what it needs from Not
 * planned yet. This writes just those lines as one batch, previewed, with
 * one Undo. Envelopes it cannot cover from Not planned yet stay as they are:
 * cover those one by one from another envelope.
 */
export function CoverAllSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.coverAll");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { undoOf, money } = useBudgetWrite();
	const fill = api.envelope.fillFromTargets.useQuery(
		m.monthKey ? { month: m.monthKey } : {},
		{ enabled: m.data !== null },
	);
	const [batchId] = useState(newId);
	const ids = useState(() => new Map<string, string>())[0];
	const lines = useMemo(
		() =>
			(fill.data?.lines ?? []).filter(
				(l) => l.step === "OVERSPENT" && l.amount.minor > 0,
			),
		[fill.data],
	);
	const input = useMemo<AssignInput | null>(() => {
		if (!m.monthKey || lines.length === 0) return null;
		return {
			batchId,
			month: m.monthKey,
			mode: "add",
			items: lines.map((l) => {
				let id = ids.get(l.envelopeId);
				if (!id) {
					id = newId();
					ids.set(l.envelopeId, id);
				}
				return { id, envelopeId: l.envelopeId, amountMinor: l.amount.minor };
			}),
		};
	}, [lines, m.monthKey, batchId, ids]);
	const preview = api.envelope.assignPreview.useMutation();
	const commit = api.envelope.assign.useMutation();
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (res, i) => {
			const taken = res.changes.find((c) => c.id === "budget.notPlannedYet");
			return taken
				? t("toast", {
						count: i.items.length,
						amount: money({
							minor: Math.abs(taken.delta.minor),
							currency: taken.delta.currency,
						}),
					})
				: t("toastShort", { count: i.items.length });
		},
		undo: (_r, i) => undoOf({ batchId: i.batchId }),
	});
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("cover")}
			title={t("title")}
		>
			{m.loading || fill.isLoading || !m.data ? (
				<SkeletonRows count={3} />
			) : lines.length === 0 ? (
				<p className="text-fg-2 text-small">{t("nothing", { pool })}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">{t("lead", { pool })}</p>
					<RowList label={t("title")} variant="flat">
						{lines.map((l) => {
							const e = m.byId.get(l.envelopeId);
							return (
								<Row
									end={<Money value={l.amount} />}
									key={l.envelopeId}
									lead={e ? <EnvelopeTile envelope={e} /> : undefined}
									sub={
										e ? (
											<RowSub
												parts={[
													t.rich("over", {
														amount: () => <Money sign="never" value={e.left} />,
													}),
												]}
											/>
										) : undefined
									}
									title={e?.name ?? t("envelopeFallback")}
								/>
							);
						})}
					</RowList>
					<MovementChanges
						byId={m.byId}
						dry={w.dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
				</div>
			)}
		</Sheet>
	);
}
