"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

/**
 * Take it back (M12): you planned more than you have, so To assign is
 * negative. The server takes the shortfall back from the envelopes that hold
 * money (Spending first, then Savings; bills stay) as one batch, previewed
 * first, and Undo returns it.
 */
export function TakeBackSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.takeBack");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money, undoOf } = useBudgetWrite();
	const [batchId] = useState(newId);
	// How much more was planned than there is: the server's figure, never a negation here.
	const planned = m.data?.verdict.plannedTooMuch ?? null;
	const owed = planned && planned.minor > 0 ? planned : null;
	const input = batchId ? { batchId } : null;
	const preview = api.envelope.fixNegativePreview.useMutation();
	const commit = api.envelope.fixNegative.useMutation();
	const w = useMoneyWrite({
		input: owed ? input : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast"),
		undo: (_r, i) => undoOf({ batchId: i.batchId }),
	});
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={
				owed ? t("takeBack", { amount: money(owed) }) : t("takeBackShort")
			}
			title={owed ? t("title", { amount: money(owed) }) : t("titleShort")}
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{owed
							? t.rich("lead", { amount: () => <Money value={owed} /> })
							: t("nothing")}
					</p>
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
