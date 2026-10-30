import { useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack, avatarSlot } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { ListGroup } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Text } from "@/ui/Text";
import { useDayRange } from "./dates";
import { BudgetLine } from "./ProjectRow";
import { balanceSides, daysSince, type ProjectItem } from "./source";

/**
 * A project's cover as a banner: the picture when it has one, else the
 * project's avatar color with its first letter, as the row cover does.
 * Content, so it fills the top of the card edge to edge; the name below is
 * what a screen reader reads.
 */
function Banner({ project }: { project: ProjectItem }) {
	const { color, space } = useTheme();
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const uri = absoluteImage(project.imageUrl, baseUrl);
	const [failed, setFailed] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new address resets
	useEffect(() => setFailed(false), [uri]);
	const palette = color as unknown as Record<string, string>;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				height: space[12] * 2,
				backgroundColor:
					palette[`avatar${avatarSlot(`project:${project.id}`)}`],
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{uri && !failed ? (
				<Image
					onError={() => setFailed(true)}
					resizeMode="cover"
					source={{ uri }}
					style={{ width: "100%", height: "100%" }}
				/>
			) : (
				<Text style={{ color: color.avatarFg }} variant="title">
					{Array.from(project.name.trim())[0]?.toUpperCase() ?? ""}
				</Text>
			)}
		</View>
	);
}

/**
 * One project of the list as a cover card (layout A): the cover banner, the
 * name, when and how many expenses, who is in it, what the group spent and
 * your share, the budget, and who owes what. The hero is the same card for
 * the project you just came back from, with a kicker, the days since, and
 * Settle up and Open project under it.
 */
export function ProjectCard({
	project,
	today,
	onPress,
	onSettle,
	hero = false,
}: {
	project: ProjectItem;
	/** The server's today, for "back 3 days ago". */
	today: string;
	onPress: () => void;
	/** The hero's Settle up. */
	onSettle?: () => void;
	hero?: boolean;
}) {
	const t = useTranslations("mobile.projects");
	const tp = useTranslations("mobile.person");
	const money = useMoneyText();
	const faces = useFaces();
	const range = useDayRange();
	const { color, space } = useTheme();
	const when = range(project.firstExpense, project.lastExpense, today);
	const back =
		hero && project.lastExpense
			? t("backAgo", { count: daysSince(project.lastExpense, today) })
			: null;
	const meta = [when, back, t("expenseCount", { count: project.expenseCount })]
		.filter(Boolean)
		.join(" · ");
	const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
	const who =
		project.people.length > 3
			? t("namesMore", {
					names: project.people
						.slice(0, 3)
						.map((p) => first(p.name))
						.join(", "),
					count: project.people.length - 3,
				})
			: project.people.map((p) => first(p.name)).join(", ");
	const shareText = project.myShare.map((m) => money(m)).join(" · ");
	const { owedToYou, youOwe } = balanceSides(project.myBalance);
	const spoken = [
		hero ? t("justBack") : null,
		project.name,
		meta,
		project.total.map((m) => t("totalSpoken", { amount: money(m) })).join(", "),
		project.solo || !shareText ? null : t("yourShare", { amount: shareText }),
		owedToYou.map((l) => t("owesYouAmount", { amount: money(l) })).join(", "),
		youOwe.map((l) => t("youOweAmount", { amount: money(l) })).join(", "),
	]
		.filter(Boolean)
		.join(", ");
	return (
		<ListGroup>
			<View>
				<Pressable
					accessibilityLabel={spoken}
					accessibilityRole="button"
					onPress={onPress}
				>
					<Banner project={project} />
					<View style={{ gap: space[2], padding: space[4] }}>
						{hero ? (
							<Text tone="fg2" variant="small">
								{t("justBack")}
							</Text>
						) : null}
						<Text numberOfLines={2} variant="section" weight="semibold">
							{project.name}
						</Text>
						<Text tone="fg2" variant="small">
							{meta}
						</Text>
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
									max={5}
									ring="surface"
									size="sm"
								/>
								<Text
									numberOfLines={1}
									style={{ flex: 1 }}
									tone="fg2"
									variant="small"
								>
									{who}
								</Text>
							</View>
						)}
						<View style={{ gap: space[1] }}>
							{project.total.map((line) => (
								<MoneyAmount
									align="left"
									key={line.currency}
									size="section"
									strong
									value={line}
								/>
							))}
							<Text tone="fg2" variant="small">
								{project.solo || !shareText
									? t("spent")
									: `${t("groupTotal")} · ${t("yourShare", { amount: shareText })}`}
							</Text>
						</View>
						{project.budget ? <BudgetLine budget={project.budget} /> : null}
						<View style={{ gap: space[1] }}>
							{owedToYou.map((line) => (
								<Text
									key={`in:${line.currency}`}
									tone="positive"
									variant="small"
								>
									{t("owesYouAmount", { amount: money(line) })}
								</Text>
							))}
							{youOwe.map((line) => (
								<Text
									key={`out:${line.currency}`}
									style={{ color: color.owe }}
									variant="small"
								>
									{t("youOweAmount", { amount: money(line) })}
								</Text>
							))}
							{project.solo ? (
								<Text tone="fg3" variant="meta">
									{t("soloShort")}
								</Text>
							) : owedToYou.length === 0 && youOwe.length === 0 ? (
								<Text tone="fg3" variant="small">
									{t("settled")}
								</Text>
							) : null}
						</View>
					</View>
				</Pressable>
				{hero ? (
					<View
						style={{
							flexDirection: "row",
							gap: space[3],
							paddingHorizontal: space[4],
							paddingBottom: space[4],
						}}
					>
						{onSettle ? (
							<View style={{ flex: 1 }}>
								<Button fill label={tp("settleUp")} onPress={onSettle} />
							</View>
						) : null}
						<View style={{ flex: 1 }}>
							<Button
								fill
								label={t("openProject")}
								onPress={onPress}
								variant="outlined"
							/>
						</View>
					</View>
				) : null}
			</View>
		</ListGroup>
	);
}
