import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { dayKey } from "@/lib/days";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { PageState, SettingsPage } from "../settings/parts";
import { quotaPercent, shiftMonth } from "./serverRules";
import { useAdminRead } from "./useAdminRead";

const MONTHS = 6;

/**
 * Tokens each account used in a month, most first, with the share of the
 * quota. The chips pick the month (this one and the five before it).
 */
export function AiUsageScreen() {
	const t = useTranslations("mobile.admin.aiUsage");
	const format = useFormatter();
	const { space } = useTheme();
	const months = useMemo(() => {
		const now = dayKey(new Date()).slice(0, 7);
		return Array.from({ length: MONTHS }, (_, i) => shiftMonth(now, -i));
	}, []);
	const [month, setMonth] = useState(months[0] ?? "");
	const { state, reload } = useAdminRead(
		(client) => client.admin.aiUsage({ yearMonth: month }),
		month,
	);

	const monthName = (ym: string) =>
		format.dateTime(new Date(`${ym}-01T12:00:00`), {
			month: "long",
			year: "numeric",
		});
	const number = (n: number) => format.number(n);

	const chips = (
		<ScrollView
			contentContainerStyle={{
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[4],
				paddingBottom: space[3],
			}}
			horizontal
			showsHorizontalScrollIndicator={false}
		>
			{months.map((ym) => (
				<Chip
					key={ym}
					label={monthName(ym)}
					onPress={() => setMonth(ym)}
					selected={ym === month}
				/>
			))}
		</ScrollView>
	);

	if (state.status !== "ready") {
		return (
			<SettingsPage>
				{chips}
				<PageState
					failed={state.status === "error"}
					onRetry={() => void reload()}
				/>
			</SettingsPage>
		);
	}
	const data = state.data;
	const usages = [...data.usages].sort((a, b) => b.tokensUsed - a.tokensUsed);

	return (
		<SettingsPage>
			{chips}
			{usages.length === 0 ? (
				<EmptyState title={t("empty")} />
			) : (
				<ListGroup>
					{usages.map((u) => {
						const ext = quotaPercent(u.externalTokensUsed, data.externalQuota);
						return (
							<ListRow
								end={<Text tone="fg2">{number(u.tokensUsed)}</Text>}
								key={u.userId}
								sub={[
									t("local", { count: number(u.localTokensUsed) }),
									ext === null
										? t("external", { count: number(u.externalTokensUsed) })
										: t("externalShare", {
												count: number(u.externalTokensUsed),
												percent: ext,
											}),
								].join(" · ")}
								title={u.username ?? t("unknown")}
							/>
						);
					})}
				</ListGroup>
			)}
		</SettingsPage>
	);
}
