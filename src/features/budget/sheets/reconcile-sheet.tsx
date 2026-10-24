"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Row, RowList } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type ReconcileInput = RouterInputs["envelope"]["reconcile"];

/**
 * Does this match your bank? (SPEC §5.11, optional): what the budget holds
 * against the Wealth accounts that are part of it. A difference is recorded
 * as one Adjustment (To assign moves by it, envelopes keep what they hold),
 * previewed first, and Undo removes it. Money people owe you is in neither
 * side and is shown apart.
 */
export function ReconcileSheet({
	open,
	onClose,
	month,
}: SheetComponentProps<"reconcile">) {
	const t = useTranslations("budgetSheets.reconcile");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { money } = useBudgetWrite();
	const check = api.envelope.bankCheck.useQuery();
	const bank = check.data ?? null;
	const currency = bank?.holds.currency ?? "";
	const amount = useAmount(currency, bank?.bank.minor ?? null);
	const [id] = useState(newId);
	const preview = api.envelope.reconcilePreview.useMutation();
	const commit = api.envelope.reconcile.useMutation();
	const remove = api.envelope.removeAdjustment.useMutation();
	const input: ReconcileInput | null =
		bank && amount.minor !== null ? { id, bankMinor: amount.minor } : null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (r) =>
			r.value.expenseId
				? t("toastRecorded", { amount: money(r.value.amount) })
				: t("toastMatched"),
		undo: (r) =>
			r.value.expenseId
				? () => remove.mutateAsync({ expenseId: r.value.expenseId as string })
				: undefined,
	});
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("record")}
			title={t("title")}
		>
			{!bank || m.loading ? (
				<SkeletonRows count={4} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">{t("lead")}</p>
					<RowList label={t("accounts")} variant="flat">
						{bank.accounts.map((a) => (
							<Row
								end={<Money.pair home={a.value} original={a.worth} />}
								key={a.id}
								title={a.name}
							/>
						))}
					</RowList>
					<Field label={t("bank")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
					<div className="flex items-baseline justify-between gap-3">
						<span className="text-fg-2 text-small">{t("holds")}</span>
						<Money figure="budget.holds" value={bank.holds} />
					</div>
					{bank.held.minor !== 0 ? (
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-fg-3 text-small">{t("held")}</span>
							<Money figure="budget.heldForOthers" value={bank.held} />
						</div>
					) : null}
					{bank.incomplete ? (
						<p className="text-fg-3 text-small">{t("incomplete")}</p>
					) : null}
					<FigureChanges dry={w.dry} poolName={pool} />
				</div>
			)}
		</Sheet>
	);
}
