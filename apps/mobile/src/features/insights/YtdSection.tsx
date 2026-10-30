import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { SectionHeader } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { RankedList } from "./RankedList";
import { type CategoryInfo, ytdRows } from "./rows";
import type { InsightsYtd } from "./source";
import type { InsightsWords } from "./useInsightsWords";

type Shown = "home" | "usd";

/**
 * Year to date against the same span last year, by category. USD totals the
 * same rows at the USD value each expense was saved with, so there is no
 * rate to pick. Currencies the lead already names are not named again.
 */
export function YtdSection({
	data,
	refs,
	named,
	words,
}: {
	data: InsightsYtd;
	refs: ReadonlyMap<string, CategoryInfo>;
	named: readonly string[];
	words: InsightsWords;
}) {
	const t = useTranslations("mobile.insights.ytd");
	const ti = useTranslations("mobile.insights");
	const noRate = useTranslations("mobile.money")("noRate");
	const money = useMoneyText();
	const { space } = useTheme();
	const [shown, setShown] = useState<Shown>("home");
	// A USD home has nothing to switch to.
	const usd = shown === "usd" && data.home !== "USD";
	const rows = useMemo(
		() => ytdRows(data.categories, refs, usd),
		[data.categories, refs, usd],
	);
	const key = usd ? "usd" : "home";
	const total = data.total[key].value;
	const last = data.lastYearTotal[key].value;
	const change = usd ? data.total.usdChangePct : data.total.changePct;
	const lastYear = words.range(data.lastYear);
	const before = last
		? last.minor === 0
			? ti("wasNone", { period: lastYear })
			: change === null
				? ti("was", { period: lastYear, amount: money(last) })
				: ti("wasChange", {
						period: lastYear,
						amount: money(last),
						change: words.change(change),
					})
		: null;
	const unnamed = data.missingRates.filter((c) => !named.includes(c));

	return (
		<View>
			<SectionHeader title={t("title")} />
			{data.home !== "USD" ? (
				<View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
					<Segmented<Shown>
						accessibilityLabel={t("currency")}
						onChange={setShown}
						options={[
							{ value: "home", label: data.home },
							{ value: "usd", label: "USD" },
						]}
						value={shown}
					/>
				</View>
			) : null}
			<View
				accessibilityLabel={[
					total ? money(total) : noRate,
					words.range(data.thisYear),
					before,
				]
					.filter(Boolean)
					.join(", ")}
				accessible
				style={{
					gap: space[1],
					paddingHorizontal: space[4],
					paddingBottom: space[2],
				}}
			>
				{total ? (
					<MoneyAmount align="left" size="section" strong value={total} />
				) : (
					<Text variant="section" weight="semibold">
						{noRate}
					</Text>
				)}
				<Text tone="fg2">
					{before
						? ti("pair", { first: words.range(data.thisYear), second: before })
						: words.range(data.thisYear)}
				</Text>
				{usd ? (
					<Text tone="fg3" variant="meta">
						{t("usdNote")}
					</Text>
				) : null}
			</View>
			{rows.length > 0 ? (
				<RankedList rows={rows} words={words} />
			) : (
				<Text
					style={{ paddingHorizontal: space[4] }}
					tone="fg3"
					variant="small"
				>
					{t("none")}
				</Text>
			)}
			{unnamed.length > 0 ? (
				<Text
					style={{ paddingHorizontal: space[4], paddingTop: space[2] }}
					tone="fg3"
					variant="small"
				>
					{ti("missingRates", { currencies: unnamed.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
