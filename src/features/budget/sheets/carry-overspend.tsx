"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Sheet } from "~/components/ui/sheet";
import { api } from "~/trpc/react";
import { MovementChanges } from "./movement-changes";
import { useMoneyWrite } from "./use-money-write";
import type { EnvelopeInGroup } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

/**
 * "Take it from November's Dining instead" (SPEC §5.5, owner Q3): last
 * month's overspend comes out of the envelope that went over, this month,
 * instead of out of To assign. One movement, previewed, with Undo. Nested in
 * the month summary: Cancel returns to it.
 */
export function CarryOverspend({
	envelopeId,
	amountMinor,
	name,
	monthName,
	byId,
	poolName,
	open,
	onClose,
}: {
	envelopeId: string;
	amountMinor: number;
	name: string;
	/** The month it comes out of: "November". */
	monthName: string;
	byId: ReadonlyMap<string, EnvelopeInGroup>;
	poolName: string;
	open: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("budgetSheets.carry");
	const { undoOf } = useBudgetWrite();
	const [id] = useState(newId);
	const preview = api.envelope.carryOverspendPreview.useMutation();
	const commit = api.envelope.carryOverspend.useMutation();
	const w = useMoneyWrite({
		input: open ? { id, envelopeId, amountMinor } : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { name, month: monthName }),
		undo: (_r, i) => undoOf({ movementId: i.id }),
	});
	return (
		<Sheet
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("take")}
			title={t("title", { name, month: monthName })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">
					{t("lead", { name, month: monthName })}
				</p>
				<MovementChanges
					byId={byId}
					dry={w.dry}
					fallbackName={name}
					poolName={poolName}
				/>
			</div>
		</Sheet>
	);
}
