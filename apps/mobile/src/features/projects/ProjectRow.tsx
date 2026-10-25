import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { BalanceColumn, useBalanceWords } from "./Balance";
import { Cover } from "./Cover";
import { useDayRange } from "./dates";
import type { ProjectItem } from "./source";

/** The budget as a bar and a sentence; the bar is the server's capped percent. */
export function BudgetLine({
	budget,
}: {
	budget: NonNullable<ProjectItem["budget"]>;
}) {
	const t = useTranslations("mobile.projects");
	const money = useMoneyText();
	const { color, radius, space, type } = useTheme();
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
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					height: space[1],
					borderRadius: radius.ctl,
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
			<Text
				style={{
					color: budget.over ? color.attentionText : color.fg2,
					fontSize: type.small.size,
				}}
			>
				{text}
			</Text>
		</View>
	);
}

/**
 * One project in the list: cover, name, when, who is in it, the group total
 * and your balance both ways. The balance is per currency and never netted.
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
	const { color, size, type } = useTheme();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const when = range(project.firstExpense, project.lastExpense, null);
	const totalText = project.total.map((m) => money(m)).join(" · ");
	const sub = [when, t("expenseCount", { count: project.expenseCount })]
		.filter(Boolean)
		.join(" · ");
	const spoken = [
		project.name,
		sub,
		project.solo
			? t("soloShort")
			: t("peopleCount", { count: project.peopleCount }),
		totalText ? t("totalSpoken", { amount: totalText }) : null,
		project.solo ? null : words(project.myBalance),
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress} selected={selected}>
			<Cover
				diameter={size.avatar.lg}
				id={project.id}
				imageUri={absoluteImage(project.imageUrl, baseUrl)}
				name={project.name}
			/>
			<View style={{ flex: 1, gap: 4 }}>
				<Text
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{project.name}
				</Text>
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{sub}
				</Text>
				{project.solo ? null : (
					<AvatarStack
						faces={faces(
							project.people.map((p) => ({
								key: p.id,
								name: p.name,
								imageUrl: p.imageUrl,
							})),
						)}
						max={4}
						size="xs"
					/>
				)}
				{project.budget ? <BudgetLine budget={project.budget} /> : null}
			</View>
			<View style={{ alignItems: "flex-end", gap: 4 }}>
				{project.solo ? (
					<>
						<Text
							style={{
								color: color.fg,
								fontSize: type.body.size,
								fontVariant: ["tabular-nums"],
								fontWeight: "500",
							}}
						>
							{totalText}
						</Text>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{t("spent")}
						</Text>
					</>
				) : (
					<BalanceColumn lines={project.myBalance} />
				)}
			</View>
		</ListRow>
	);
}
