import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { CategoryTile, ListGroup, ListRow } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Text } from "@/ui/Text";
import { dayDate } from "./dates";
import { groupByDay } from "./days";
import type { ProjectExpense } from "./source";

/**
 * One expense of the project: its category tile, what it was, who paid (a
 * solo project says the category instead), the amount, and your share under
 * it. The day is the group's heading. An expense waiting on a review says so
 * in words.
 */
export function ProjectExpenseRow({
	expense,
	solo = false,
}: {
	expense: ProjectExpense;
	solo?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const format = useFormatter();
	const money = useMoneyText();
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
	const sub = solo ? (expense.category?.name ?? "") : paidBy;
	return (
		<ListRow
			accessibilityLabel={[
				expense.title,
				waiting,
				paidBy,
				expense.category?.name ?? null,
				day,
				money(expense.amount),
				share,
			]
				.filter(Boolean)
				.join(", ")}
			end={
				<View style={{ alignItems: "flex-end", flexShrink: 1 }}>
					<MoneyAmount value={expense.amount} />
					{share ? (
						<Text numberOfLines={1} tone="fg3" variant="meta">
							{share}
						</Text>
					) : null}
				</View>
			}
			lead={<CategoryTile category={expense.category} />}
			sub={
				<Text numberOfLines={1} tone="fg3" variant="meta">
					{waiting ? (
						<Text tone="attention" variant="meta" weight="medium">
							{sub ? `${waiting} · ` : waiting}
						</Text>
					) : null}
					{sub}
				</Text>
			}
			title={expense.title}
		/>
	);
}

/** The expenses in day groups, newest day first: a short date, then its rows in one group. */
export function ProjectExpenseDays({
	expenses,
	solo,
}: {
	expenses: ProjectExpense[];
	solo: boolean;
}) {
	const format = useFormatter();
	const { size, space } = useTheme();
	return (
		<>
			{groupByDay(expenses).map((group) => (
				<View key={group.day}>
					<Text
						accessibilityRole="header"
						style={{
							paddingHorizontal: size.gutter.phone,
							paddingTop: space[4],
							paddingBottom: space[2],
						}}
						tone="fg2"
						variant="small"
						weight="medium"
					>
						{format.dateTime(dayDate(group.day), {
							weekday: "short",
							month: "short",
							day: "numeric",
						})}
					</Text>
					<ListGroup>
						{group.expenses.map((expense) => (
							<ProjectExpenseRow
								expense={expense}
								key={expense.id}
								solo={solo}
							/>
						))}
					</ListGroup>
				</View>
			))}
		</>
	);
}
