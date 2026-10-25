"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { newId } from "./use-write";

type ConfirmInput = RouterInputs["envelope"]["confirmStartingMoney"];

/**
 * Starting money (D34): how much you have right now. The server compares it
 * with what the budget held: money in is added for what you have plus what
 * was already spent since the start, or an adjustment takes out what the
 * budget held beyond what you have. The preview says which, in the server's
 * figures, before anything is written.
 */
function StartingMoneyForm({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.startingMoney");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const f = useDateFormat();
	const currency = m.data?.book.currency ?? "";
	const amount = useAmount(currency);
	const [id] = useState(newId);
	const preview = api.envelope.confirmStartingMoneyPreview.useMutation();
	const commit = api.envelope.confirmStartingMoney.useMutation();
	const undo = api.envelope.undoChange.useMutation();
	const input: ConfirmInput | null =
		amount.minor !== null ? { id, amountMinor: amount.minor } : null;
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: () => t("toast"),
		undo: (r) => () => undo.mutateAsync({ id: r.value.changeId }),
	});
	const v = w.dry.preview?.value ?? null;
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("save")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("lead")}</p>
				<Field label={t("have")}>
					<MoneyInput
						autoFocus
						currency={currency}
						onChange={(text) => amount.set(text)}
						value={amount.text}
					/>
				</Field>
				<FigureChanges
					dry={w.dry}
					idle={t("idle")}
					own={(p) => {
						const r = p.value;
						return [
							...(r.booked.minor > 0
								? [
										{
											key: "in",
											label: t("moneyIn"),
											value: <Money value={r.booked} />,
										},
									]
								: []),
							...(r.booked.minor < 0
								? [
										{
											key: "adjust",
											label: t("adjustment"),
											value: <Money value={r.booked} />,
										},
									]
								: []),
						];
					}}
					poolName={pool}
				/>
				{v && v.alreadySpent.minor > 0 ? (
					<p className="text-fg-2 text-small">
						{t.rich("includes", {
							amount: () => <Money value={v.alreadySpent} />,
							date: f.medium(v.since),
						})}
					</p>
				) : null}
				{v && v.booked.minor < 0 ? (
					<p className="text-fg-2 text-small">
						{t.rich("shortfall", {
							amount: () => <Money sign="never" value={v.booked} />,
						})}
					</p>
				) : null}
				{v && v.booked.minor === 0 ? (
					<p className="text-fg-2 text-small">{t("nothing")}</p>
				) : null}
			</div>
		</Sheet>
	);
}

/** Starting money: the one question a migrated budget asks before it counts. */
export function StartingMoneySheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.startingMoney");
	const m = useMonth(props.month);
	if (m.loading || !m.data)
		return (
			<Sheet
				detent="large"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("title")}
			>
				<SkeletonRows count={3} />
			</Sheet>
		);
	return <StartingMoneyForm {...props} />;
}
