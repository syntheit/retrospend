"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { monthStartIso } from "./months";
import type { PageNotice } from "./view-model";

/**
 * The page's one notice (R14). The sentence says what happened with its
 * amount from the server; the one button opens the sheet that fixes it.
 */
export function BudgetNotice({
	notice,
	data,
	onAction,
}: {
	notice: PageNotice;
	data: GetMonthOutput;
	onAction: (n: PageNotice) => void;
}) {
	const t = useTranslations("budgetPage.notice");
	const { month } = useRowDates();
	const v = data.verdict;
	const action = (label: string) => (
		<Button kind="secondary" onClick={() => onAction(notice)} size="sm">
			{label}
		</Button>
	);
	switch (notice.kind) {
		case "welcomeBack":
			return (
				<Notice action={action(t("welcomeBackAction"))}>
					{t("welcomeBack")}
				</Notice>
			);
		case "summary":
			return (
				<Notice action={action(t("summaryAction"))}>
					{t("summary", { month: month(monthStartIso(notice.month)) })}
				</Notice>
			);
		case "notPlanned":
			return (
				<Notice action={action(t("usePlan"))}>
					{t.rich("notPlanned", {
						amount: () => <Money value={v.notice?.amount ?? null} />,
					})}
				</Notice>
			);
		case "overspent":
			return (
				<Notice action={action(t("cover"))} tone="attention">
					{t.rich("overspent", {
						count: notice.count,
						name: notice.name ?? "",
						amount: () => <Money value={v.over} />,
					})}
				</Notice>
			);
	}
}
