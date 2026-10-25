"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api } from "~/trpc/react";
import type { SheetProps } from "./types";
import { useAmount } from "./use-amount";
import { useMonth } from "./use-month";
import { useMonthYear } from "./use-month-name";
import { useBudgetWrite } from "./use-write";

type Strategy = "AVALANCHE" | "SNOWBALL";

/**
 * The payoff plan (SPEC §5.11): your debts with their rate and minimum,
 * which to pay first, and the extra you put in each month on top of the
 * minimums. The projection (debt-free month, interest, each debt's payoff
 * month) is the server's and follows what you type without saving. Saving
 * moves no money; the extra gets a set-aside target in its envelope, and
 * Undo puts the previous plan back.
 */
export function DebtSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.debt");
	const m = useMonth(month);
	const yearOf = useMonthYear();
	const { refresh, saved } = useBudgetWrite();
	const catalog = api.entry.catalog.useQuery();
	const plan = api.envelope.payoffPlan.useQuery();
	const currency = m.data?.book.currency ?? "";
	const [strategy, setStrategy] = useState<Strategy | null>(null);
	const current: Strategy =
		strategy ?? (plan.data?.strategy === "SNOWBALL" ? "SNOWBALL" : "AVALANCHE");
	const extra = useAmount(currency, plan.data?.extraMonthly.minor ?? null);
	const project = api.envelope.payoffProject.useQuery(
		{ strategy: current, extraMonthlyMinor: extra.minor ?? 0 },
		{ enabled: !!plan.data, placeholderData: keepPreviousData, retry: false },
	);
	const save = api.envelope.savePayoffPlan.useMutation();
	const revert = api.envelope.revertPayoffPlan.useMutation();
	const p = project.data ?? null;
	const nameOf = (id: string) =>
		catalog.data?.places.find((x) => x.id === id)?.name ?? t("debtFallback");

	const onSubmit = async () => {
		if (extra.minor === null) return false;
		await save.mutateAsync({
			strategy: current,
			extraMonthlyMinor: extra.minor,
			customOrder: [],
			envelopeId: plan.data?.envelopeId ?? null,
		});
		await refresh();
		saved(t("toast"), () => revert.mutateAsync());
		return undefined;
	};
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={extra.minor === null}
			submitLabel={t("save")}
			title={t("title")}
		>
			{plan.isLoading || m.loading || !m.data ? (
				<SkeletonRows count={4} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					{p && p.debts.length === 0 ? (
						<p className="text-fg-2 text-small">{t("none")}</p>
					) : (
						<RowList label={t("debts")} variant="flat">
							{(p?.debts ?? []).map((d) => (
								<Row
									end={<Money value={d.balance} />}
									key={d.assetAccountId}
									sub={
										<RowSub
											parts={[
												t.rich("terms", {
													apr: d.aprPercent,
													minimum: () => <Money value={d.minimum} />,
												}),
												d.payoffMonth
													? t("freeBy", { month: yearOf(d.payoffMonth) })
													: null,
											]}
										/>
									}
									title={nameOf(d.assetAccountId)}
								/>
							))}
						</RowList>
					)}
					<Field label={t("first")}>
						<Segmented
							label={t("first")}
							onChange={setStrategy}
							options={[
								{ value: "AVALANCHE", label: t("avalanche") },
								{ value: "SNOWBALL", label: t("snowball") },
							]}
							value={current}
						/>
					</Field>
					<p className="text-fg-3 text-small">{t(`about.${current}`)}</p>
					<Field label={t("extra")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => extra.set(text)}
							value={extra.text}
						/>
					</Field>
					{p?.diverges ? (
						<Notice tone="attention">{t("diverges")}</Notice>
					) : null}
					{p ? (
						<RowList label={t("result")} variant="flat">
							<Row
								end={
									<span className="font-semibold">
										{p.debtFreeMonth
											? yearOf(p.debtFreeMonth)
											: p.diverges
												? t("neverAtPayment")
												: t("never")}
									</span>
								}
								title={t("debtFree")}
							/>
							<Row
								end={<Money value={p.totalInterest} />}
								title={t("interest")}
							/>
						</RowList>
					) : null}
					{p?.incomplete ? (
						<p className="text-fg-3 text-small">{t("incomplete")}</p>
					) : null}
					<p className="text-fg-3 text-small">{t("note")}</p>
				</div>
			)}
		</Sheet>
	);
}
