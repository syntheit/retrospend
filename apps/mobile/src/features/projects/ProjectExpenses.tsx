import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { CategoryTile, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { dayDate } from "./dates";
import type { ProjectExpense } from "./source";

/**
 * One expense of the project: what it was, who paid, when, the amount, and
 * your share under it. An expense waiting on a review says so in words.
 */
export function ProjectExpenseRow({ expense }: { expense: ProjectExpense }) {
	const t = useTranslations("mobile.projects");
	const format = useFormatter();
	const money = useMoneyText();
	const { color, type } = useTheme();
	const day = format.dateTime(dayDate(expense.date), {
		month: "short",
		day: "numeric",
	});
	const waiting = expense.waiting ? t(`waiting.${expense.waiting}`) : null;
	const paidBy = expense.payerIsMe
		? t("paidByMe")
		: t("paidByName", { name: expense.payerName ?? "" });
	const share = expense.share
		? t("yourShare", { amount: money(expense.share) })
		: null;
	const sub = [paidBy, expense.category?.name ?? null, day].filter(
		(part): part is string => Boolean(part),
	);
	return (
		<ListRow
			accessibilityLabel={[
				expense.title,
				waiting,
				...sub,
				money(expense.amount),
				share,
			]
				.filter(Boolean)
				.join(", ")}
		>
			<CategoryTile category={expense.category} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{expense.title}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{waiting ? (
						<Text style={{ color: color.attentionText, fontWeight: "500" }}>
							{waiting}
							{" · "}
						</Text>
					) : null}
					{sub.join(" · ")}
				</Text>
			</View>
			<View style={{ alignItems: "flex-end", gap: 2 }}>
				<MoneyAmount value={expense.amount} />
				{share ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{share}
					</Text>
				) : null}
			</View>
		</ListRow>
	);
}
