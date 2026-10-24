"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { useBudgetSheets } from "./controls";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";
import { newId, useBudgetWrite } from "./use-write";

type Choice = "CATCH_UP" | "SET_HAVE_NOW" | "START_FRESH";
type Input = RouterInputs["envelope"]["welcomeBack"];

/**
 * Welcome back (SPEC §5.5, B10, no blame): after weeks away, one calm sheet
 * with three ways back. Catch up opens the summaries that closed on their
 * own; Set what I have now writes one Adjustment from the money you have
 * (prefilled from Wealth); Start fresh returns every envelope's Left to
 * To assign in one batch. Each is previewed by the server and undoable.
 */
export function WelcomeBackSheet({
	open,
	onClose,
	month,
}: SheetComponentProps<"welcomeBack">) {
	const t = useTranslations("budgetSheets.welcomeBack");
	const sheets = useBudgetSheets();
	const monthName = useMonthName();
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { undoOf } = useBudgetWrite();
	const state = api.envelope.welcomeBackState.useQuery();
	const wb = state.data ?? null;
	const [choice, setChoice] = useState<Choice>("CATCH_UP");
	const have = useAmount(
		wb?.bank.holds.currency ?? "",
		wb?.bank.bank.minor ?? null,
	);
	const [id] = useState(newId);
	const [batchId] = useState(newId);
	const preview = api.envelope.welcomeBackPreview.useMutation();
	const commit = api.envelope.welcomeBack.useMutation();
	const remove = api.envelope.removeAdjustment.useMutation();

	const input = useMemo<Input | null>(() => {
		if (choice === "CATCH_UP") return { choice };
		if (choice === "START_FRESH") return { choice, batchId };
		return have.minor === null ? null : { choice, id, amountMinor: have.minor };
	}, [choice, batchId, id, have.minor]);

	const w = useMoneyWrite({
		input: wb ? input : null,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (_r, i) => t(`toast.${i.choice}`),
		undo: (r, i) => {
			if (i.choice === "START_FRESH") return undoOf({ batchId: i.batchId });
			const expenseId = r.value.adjustment?.expenseId;
			return i.choice === "SET_HAVE_NOW" && expenseId
				? () => remove.mutateAsync({ expenseId })
				: undefined;
		},
		after: (r) => {
			const first = r.value.months[0];
			if (r.value.choice === "CATCH_UP" && first)
				sheets.open("close", { closedMonth: first });
		},
	});

	const closed = (wb?.months ?? []).map((x) => monthName(x.month)).join(", ");
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t(`go.${choice}`)}
			title={t("title")}
		>
			{!wb || m.loading ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{wb.months.length > 0
							? t("lead", { months: closed, count: wb.months.length })
							: t("leadNone")}
					</p>
					<Segmented
						label={t("choice")}
						onChange={setChoice}
						options={[
							{ value: "CATCH_UP", label: t("catchUp") },
							{ value: "SET_HAVE_NOW", label: t("haveNow") },
							{ value: "START_FRESH", label: t("startFresh") },
						]}
						value={choice}
					/>
					<p className="text-fg-3 text-small">{t(`about.${choice}`)}</p>
					{choice === "SET_HAVE_NOW" ? (
						<Field label={t("haveLabel")}>
							<MoneyInput
								currency={wb.bank.holds.currency}
								onChange={(text) => have.set(text)}
								value={have.text}
							/>
						</Field>
					) : null}
					{choice === "CATCH_UP" ? (
						<p className="text-fg-3 text-small">{t("catchUpNothing")}</p>
					) : (
						<FigureChanges dry={w.dry} poolName={pool} />
					)}
				</div>
			)}
		</Sheet>
	);
}
