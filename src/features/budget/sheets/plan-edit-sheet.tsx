"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type SaveDraft = RouterInputs["envelope"]["saveDraft"];

/**
 * Plan next month: the amount one envelope gets in the draft. A plan is a
 * draft until payday, so this moves no money and the month itself does not
 * change; Undo puts the previous amount back. The draft starts from the one
 * being edited, else from the saved plan, and keeps every other line.
 */
export function PlanEditSheet({
	open,
	onClose,
	month,
	envelopeId,
}: SheetProps<{ envelopeId: string }>) {
	const t = useTranslations("budgetSheets.planEdit");
	const m = useMonth(month);
	const { refresh, saved } = useBudgetWrite();
	const drafts = api.envelope.drafts.useQuery(
		{ kind: "PLAN", ...(m.monthKey ? { month: m.monthKey } : {}) },
		{ enabled: m.monthKey !== null },
	);
	const save = api.envelope.saveDraft.useMutation();
	const env = m.byId.get(envelopeId) ?? null;
	const currency = m.data?.book.currency ?? "";
	const base = drafts.data?.open ?? drafts.data?.saved ?? null;
	const planned =
		base?.lines.find((l) => l.envelopeId === envelopeId)?.amountMinor ?? null;
	const amount = useAmount(currency, planned ?? 0);
	const [fallbackId] = useState(newId);

	const write = (lines: SaveDraft["lines"]): SaveDraft | null =>
		m.monthKey
			? {
					id: drafts.data?.open?.id ?? fallbackId,
					kind: "PLAN",
					month: m.monthKey,
					lines,
					moves: [],
					expectedIn: base?.expectedIn ?? [],
					pretend: [],
				}
			: null;
	const linesWith = (minor: number): SaveDraft["lines"] => [
		...(base?.lines ?? []).filter((l) => l.envelopeId !== envelopeId),
		{ envelopeId, amountMinor: minor },
	];

	const onSubmit = async () => {
		if (amount.minor === null) return false;
		const next = write(linesWith(amount.minor));
		if (!next) return false;
		const before = base?.lines ?? [];
		await save.mutateAsync(next);
		await refresh();
		saved(t("toast", { name: env?.name ?? "" }), async () => {
			const prev = write(before);
			if (prev) await save.mutateAsync(prev);
		});
		return undefined;
	};
	return (
		<Sheet
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={amount.minor === null}
			submitLabel={t("save")}
			title={t("title", { name: env?.name ?? "" })}
		>
			{m.loading || drafts.isLoading || !m.data ? (
				<SkeletonRows count={2} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">{t("lead")}</p>
					<Field label={t("planned")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					{env?.target && env.target.need.minor > 0 ? (
						<p className="text-fg-3 text-small">
							{t.rich("target", {
								amount: () => <Money value={env.target?.need ?? null} />,
							})}
						</p>
					) : null}
				</div>
			)}
		</Sheet>
	);
}
