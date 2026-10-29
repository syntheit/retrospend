import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { absoluteImage, useFaces } from "@/features/read/faces";
import { heroCents, MoneyAmount } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { Hero } from "@/ui/Hero";
import { Text } from "@/ui/Text";
import { Cover } from "./Cover";
import { useDayRange } from "./dates";
import { BudgetLine } from "./ProjectRow";
import type { ProjectPage } from "./source";

/**
 * The top of a project: a compact meta line (who is in it, when, the
 * currency), the tabs right under it, then the one hero (the group total,
 * or what a solo project spent, with the expense count), your share, and the
 * budget. In the detail pane, where there is no navigation bar, the cover
 * and name lead.
 */
export function ProjectHeader({
	page,
	pane,
	tabs,
}: {
	page: ProjectPage;
	/** The detail pane of a list-detail pair: it has no navigation bar to name the project. */
	pane: boolean;
	/** The tab control, drawn right under the meta line. */
	tabs: ReactNode;
}) {
	const t = useTranslations("mobile.projects");
	const faces = useFaces();
	const range = useDayRange();
	const money = useMoneyText();
	const { connection } = useServerConnection();
	const { size, space } = useTheme();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const others = page.members.filter((m) => !m.isMe && m.leftOn === null);
	const when = range(page.firstExpense, page.lastExpense, page.today);
	const meta = [
		page.solo ? t("solo") : null,
		page.status === "ARCHIVED" ? t("archived") : null,
		when,
		page.primaryCurrency,
	].filter(Boolean);
	const [lead, ...rest] = page.total;
	const sub = [
		t("expenseCount", { count: page.expenseCount }),
		...rest.map((line) => money(line)),
	].join(" · ");
	return (
		<View>
			{pane ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space[3],
						padding: space[4],
					}}
				>
					<Cover
						diameter={size.avatar.default}
						id={page.id}
						imageUri={absoluteImage(page.imageUrl, baseUrl)}
						name={page.name}
					/>
					<Text accessibilityRole="header" style={{ flex: 1 }} variant="title">
						{page.name}
					</Text>
				</View>
			) : null}
			<View
				accessibilityLabel={[
					others.map((m) => m.name).join(", "),
					meta.join(", "),
				]
					.filter(Boolean)
					.join(", ")}
				accessible
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[2],
					paddingHorizontal: size.gutter.phone,
					paddingVertical: space[2],
				}}
			>
				{page.solo ? null : (
					<AvatarStack
						faces={faces(
							others.map((m) => ({
								key: m.id,
								name: m.name,
								imageUrl: m.imageUrl,
							})),
						)}
						max={4}
						size="sm"
					/>
				)}
				<Text numberOfLines={1} style={{ flex: 1 }} tone="fg2" variant="small">
					{meta.join(" · ")}
				</Text>
			</View>
			{tabs}
			<View
				style={{
					gap: space[4],
					paddingHorizontal: size.gutter.phone,
					paddingTop: space[4],
				}}
			>
				{lead ? (
					<Hero
						label={page.solo ? t("spent") : t("groupTotal")}
						sub={sub}
						value={money(lead, { cents: heroCents(lead.currency) })}
					/>
				) : null}
				{page.solo || page.myShare.length === 0 ? null : (
					<View
						style={{
							flexDirection: "row",
							alignItems: "flex-start",
							justifyContent: "space-between",
							gap: space[3],
						}}
					>
						<Text>{t("yourShareLabel")}</Text>
						<View style={{ alignItems: "flex-end" }}>
							{page.myShare.map((line) => (
								<MoneyAmount key={line.currency} strong value={line} />
							))}
						</View>
					</View>
				)}
				{page.budget ? <BudgetLine budget={page.budget} /> : null}
			</View>
		</View>
	);
}
