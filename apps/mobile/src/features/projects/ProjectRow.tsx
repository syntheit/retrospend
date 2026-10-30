import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { ListRow } from "@/ui/List";
import { StatusText } from "@/ui/StatusText";
import { Text } from "@/ui/Text";
import { useBalanceWords } from "./Balance";
import { Cover } from "./Cover";
import { useDayRange } from "./dates";
import { balanceSides, type ProjectItem } from "./source";

/**
 * The budget as a line and a 4 point bar under it: what is left on the left
 * (or how far over), "of" the budget on the right. The bar is the server's
 * capped percent.
 */
export function BudgetLine({
	budget,
}: {
	budget: NonNullable<ProjectItem["budget"]>;
}) {
	const t = useTranslations("mobile.projects");
	const money = useMoneyText();
	const { color, radius, space } = useTheme();
	const text = budget.over
		? t("budgetOver", {
				amount: money({
					minor: -budget.left.minor,
					currency: budget.left.currency,
				}),
			})
		: t("budgetLeft", { amount: money(budget.left) });
	return (
		<View style={{ gap: space[1] }}>
			<View
				style={{
					flexDirection: "row",
					justifyContent: "space-between",
					gap: space[2],
				}}
			>
				<Text
					style={{ flexShrink: 1 }}
					tone={budget.over ? "attention" : "fg"}
					variant="small"
					weight="medium"
				>
					{text}
				</Text>
				<Text tone="fg3" variant="meta">
					{t("budgetOf", { amount: money(budget.amount) })}
				</Text>
			</View>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					height: space[1],
					borderRadius: radius.chip,
					backgroundColor: color.raised,
					overflow: "hidden",
				}}
			>
				<View
					style={{
						width: `${budget.used / 100}%`,
						height: space[1],
						backgroundColor: budget.over ? color.attention : color.accent,
					}}
				/>
			</View>
		</View>
	);
}

/**
 * One project in the list: a 44 cover, name, when, who is in it and where
 * your balance stands (per currency, never netted), a budget bar, and the
 * spent column (what the group spent, and your share of it).
 */
export function ProjectRow({
	project,
	onPress,
	selected,
}: {
	project: ProjectItem;
	onPress: () => void;
	selected?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const money = useMoneyText();
	const faces = useFaces();
	const words = useBalanceWords();
	const range = useDayRange();
	const { connection } = useServerConnection();
	const { size, space } = useTheme();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const when = range(project.firstExpense, project.lastExpense, null);
	const totalText = project.total.map((m) => money(m)).join(" · ");
	const shareText = project.myShare.map((m) => money(m)).join(" · ");
	const sub = [when, t("expenseCount", { count: project.expenseCount })]
		.filter(Boolean)
		.join(" · ");
	const { owedToYou, youOwe } = balanceSides(project.myBalance);
	const spoken = [
		project.name,
		sub,
		project.solo
			? t("soloShort")
			: t("peopleCount", { count: project.peopleCount }),
		totalText ? t("totalSpoken", { amount: totalText }) : null,
		project.solo || !shareText ? null : t("yourShare", { amount: shareText }),
		project.solo ? null : words(project.myBalance),
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress} selected={selected}>
			<View style={{ alignSelf: "flex-start" }}>
				<Cover
					diameter={size.avatar.row}
					id={project.id}
					imageUri={absoluteImage(project.imageUrl, baseUrl)}
					name={project.name}
				/>
			</View>
			<View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "flex-start",
						gap: space[3],
					}}
				>
					<View style={{ flex: 1, minWidth: 0 }}>
						<Text numberOfLines={2} weight="medium">
							{project.name}
						</Text>
						<Text tone="fg3" variant="meta">
							{sub}
						</Text>
					</View>
					<View style={{ alignItems: "flex-end", flexShrink: 1 }}>
						{project.total.map((line) => (
							<MoneyAmount key={line.currency} value={line} />
						))}
						<Text style={{ textAlign: "right" }} tone="fg3" variant="meta">
							{project.solo || !shareText
								? t("spent")
								: t("yourShare", { amount: shareText })}
						</Text>
					</View>
				</View>
				{project.solo ? null : (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[2],
						}}
					>
						<AvatarStack
							faces={faces(
								project.people.map((p) => ({
									key: p.id,
									name: p.name,
									imageUrl: p.imageUrl,
								})),
							)}
							max={4}
							ring="surface"
							size="sm"
						/>
						{owedToYou.length === 0 && youOwe.length === 0 ? (
							<StatusText kind="settled" size="sm" />
						) : null}
					</View>
				)}
				{owedToYou.map((line) => (
					<StatusText
						key={`in:${line.currency}`}
						label={t("owesYouAmount", { amount: money(line) })}
						size="sm"
						tone="positive"
					/>
				))}
				{youOwe.map((line) => (
					<StatusText
						key={`out:${line.currency}`}
						label={t("youOweAmount", { amount: money(line) })}
						size="sm"
						tone="owe"
					/>
				))}
				{project.budget ? <BudgetLine budget={project.budget} /> : null}
			</View>
		</ListRow>
	);
}
