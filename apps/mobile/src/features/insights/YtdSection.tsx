import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import { SectionHeader } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Segmented } from "@/ui/Segmented";
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
	const { color, space, type } = useTheme();
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
					<Text
						style={{
							color: color.fg,
							fontSize: type.section.size,
							fontWeight: "600",
						}}
					>
						{noRate}
					</Text>
				)}
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{before
						? ti("pair", { first: words.range(data.thisYear), second: before })
						: words.range(data.thisYear)}
				</Text>
				{usd ? (
					<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
						{t("usdNote")}
					</Text>
				) : null}
			</View>
			{rows.length > 0 ? (
				<RankedList rows={rows} words={words} />
			) : (
				<Text
					style={{
						color: color.fg3,
						fontSize: type.small.size,
						paddingHorizontal: space[4],
					}}
				>
					{t("none")}
				</Text>
			)}
			{unnamed.length > 0 ? (
				<Text
					style={{
						color: color.fg3,
						fontSize: type.small.size,
						paddingHorizontal: space[4],
						paddingTop: space[2],
					}}
				>
					{ti("missingRates", { currencies: unnamed.join(", ") })}
				</Text>
			) : null}
		</View>
	);
}
