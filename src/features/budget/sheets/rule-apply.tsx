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
 * "Also apply to this month's money in" (SPEC §5.10): a rule only runs on
 * money that arrives after it exists; this runs it on what already came in
 * this month. One batch, previewed by the server, one Undo.
 */
export function RuleApply({
	ruleId,
	ruleName,
	byId,
	poolName,
	open,
	onClose,
}: {
	ruleId: string;
	ruleName: string;
	byId: ReadonlyMap<string, EnvelopeInGroup>;
	poolName: string;
	open: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("budgetSheets.rules.apply");
	const { undoOf } = useBudgetWrite();
	const [batchId] = useState(newId);
	const preview = api.envelope.applyRuleToMonthPreview.useMutation();
	const commit = api.envelope.applyRuleToMonth.useMutation();
	const w = useMoneyWrite({
		input: open ? { batchId, ruleId } : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast", { name: ruleName }),
		undo: (_r, i) => undoOf({ batchId: i.batchId }),
	});
	return (
		<Sheet
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("apply")}
			title={t("title", { name: ruleName })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("lead")}</p>
				<MovementChanges
					byId={byId}
					dry={w.dry}
					fallbackName={t("envelopeFallback")}
					moved={(p) => p.value.movement?.envelopes ?? []}
					poolName={poolName}
				/>
			</div>
		</Sheet>
	);
}
