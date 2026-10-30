import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useFormatMoney } from "@/lib/money";
import { type TargetLine, targetLine } from "./envelopeLine";
import type { BudgetEnvelope } from "./source";

/**
 * The target sentence under an envelope's name, worded ("$300 a month",
 * "$1,200 by Dec 1"), and whether it needs the person (no rate yet). A
 * foreign target shows its own currency first and the home amount second.
 */
export function useTargetText() {
	const t = useTranslations("mobile.budget.targetLine");
	const tr = useTranslations("mobile.budget.row");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const { pair } = useFormatMoney();
	const day = (iso: string) =>
		format.dateTime(new Date(`${iso}T00:00:00Z`), {
			month: "short",
			day: "numeric",
			timeZone: "UTC",
		});
	const asked = (line: Exclude<TargetLine, { kind: "none" | "noRate" }>) => {
		if (!line.foreign) return { main: money(line.amount), home: null };
		const shown = pair(line.foreign, line.amount);
		return { main: shown.original ?? "", home: shown.home };
	};
	return (
		e: BudgetEnvelope,
		limits: boolean,
	): { text: string; attention: boolean } | null => {
		const line = targetLine(e);
		const parts: string[] = [];
		let attention = false;
		switch (line.kind) {
			case "none":
				parts.push(limits ? t("noLimit") : t("none"));
				break;
			case "noRate":
				parts.push(tr("noRate", { currency: line.currency }));
				attention = true;
				break;
			case "monthly": {
				const a = asked(line);
				parts.push(
					line.cadence === "WEEK"
						? t("perWeek", { amount: a.main })
						: t("perMonth", { amount: a.main }),
				);
				if (a.home) parts.push(tm("approx", { amount: a.home }));
				break;
			}
			case "bill": {
				const a = asked(line);
				parts.push(
					line.dueDate
						? t("billDue", { amount: a.main, date: day(line.dueDate) })
						: t("perMonth", { amount: a.main }),
				);
				if (a.home) parts.push(tm("approx", { amount: a.home }));
				break;
			}
			case "goal": {
				const a = asked(line);
				parts.push(
					line.saved
						? t("goalProgress", { saved: money(line.saved), amount: a.main })
						: t("goal", { amount: a.main }),
				);
				if (line.dueDate) parts.push(t("goalBy", { date: day(line.dueDate) }));
				if (a.home) parts.push(tm("approx", { amount: a.home }));
				break;
			}
		}
		if (e.leftThisWeek && e.status !== "OVERSPENT") {
			parts.push(tr("leftThisWeek", { amount: money(e.leftThisWeek.amount) }));
		}
		return parts.length > 0 ? { text: parts.join(" · "), attention } : null;
	};
}
