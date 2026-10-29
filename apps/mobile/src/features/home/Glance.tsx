import { router } from "expo-router";
import { isValidElement, type ReactElement } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { currenciesHref } from "@/features/account/places";
import { useFaces } from "@/features/read/faces";
import { MoneyAmount, useRateTypeLabel } from "@/features/read/MoneyAmount";
import { useMoneyText } from "@/features/read/useMoneyText";
import { wealthHref } from "@/features/wealth/routes";
import { useTheme } from "@/theme";
import { AvatarStack } from "@/ui/Avatar";
import { LinkButton } from "@/ui/List";
import { Text } from "@/ui/Text";
import { useHomeDates } from "./dates";
import { BudgetCard } from "./BudgetCard";
import { HomeCard } from "./HomeCard";
import { HomeTile, TileNote } from "./HomeTile";
import {
	type Glance as GlanceData,
	type HomeData,
	notPlannedOf,
} from "./source";

type Figure = GlanceData["owedToYou"]["value"];

/** A tile's figure: the money, or words when the server could not compute it. */
function TileFigure({
	value,
	tone,
	approx,
	code,
}: {
	value: Figure;
	tone?: "default" | "positive";
	approx?: boolean;
	code?: boolean;
}) {
	const noRate = useTranslations("mobile.money")("noRate");
	return value ? (
		<MoneyAmount
			align="left"
			approx={approx}
			code={code}
			size="section"
			strong
			tone={tone}
			value={value}
		/>
	) : (
		<Text variant="section">{noRate}</Text>
	);
}

/** Zero is not shown (GUIDELINE 7): a tile with nothing to say is left out. */
const isZero = (value: Figure) => value !== null && value.minor === 0;

/**
 * Home's glance as summary cards (home.html, phone A): the Spent hero card
 * (as the web leads), the budget card, then four doorways, two to a row:
 * what is not planned yet, Owed to you with faces, Dollar today, Net worth.
 * Every number is the server's figure; a tile opens its page, and one with
 * nothing to show is left out.
 */
export function Glance({
	glance,
	approx,
	owers,
}: {
	glance: GlanceData;
	approx: HomeData["approx"];
	owers: HomeData["owers"];
}) {
	const t = useTranslations("mobile.home");
	const money = useTranslations("mobile.money");
	const noRate = money("noRate");
	const format = useMoneyText();
	const faces = useFaces();
	const dates = useHomeDates();
	const rateLabel = useRateTypeLabel();
	const { space } = useTheme();
	const tiles: ReactElement[] = [];

	const pool = notPlannedOf(glance);
	if (pool) {
		const label = t(
			pool.pool === "TO_ASSIGN" ? "tile.toAssign" : "tile.notPlanned",
		);
		tiles.push(
			<HomeTile
				glyph="Wallet"
				key="pool"
				label={label}
				onPress={() => router.navigate("/budget")}
				spoken={`${label}, ${format(pool.amount)}, ${t("tile.waiting")}`}
			>
				<TileFigure value={pool.amount} />
				<TileNote>{t("tile.waiting")}</TileNote>
			</HomeTile>,
		);
	}

	// Owed to you leads; with nothing owed to you, what you owe takes its place.
	const owed = glance.owedToYou.value;
	const owe = glance.youOwe.value;
	if (!(isZero(owed) && isZero(owe))) {
		const leadsWithOwe = isZero(owed) && owe !== null;
		const lead = leadsWithOwe ? owe : owed;
		const label = t(leadsWithOwe ? "youOwe" : "owedToYou");
		const note =
			!leadsWithOwe && (owe === null || owe.minor > 0)
				? t("tile.youOwe", {
						amount: owe
							? approx.youOwe
								? money("approx", { amount: format(owe) })
								: format(owe)
							: noRate,
					})
				: null;
		const stack = leadsWithOwe ? [] : faces(owers);
		tiles.push(
			<HomeTile
				foot={
					stack.length > 0 ? (
						<AvatarStack faces={stack} ring="surface" size="xs" />
					) : undefined
				}
				glyph="HandCoins"
				key="owed"
				label={label}
				onPress={() =>
					router.navigate({
						pathname: "/people",
						params: { segment: "people" },
					})
				}
				spoken={[label, lead ? format(lead) : noRate, note]
					.filter(Boolean)
					.join(", ")}
			>
				<TileFigure
					approx={leadsWithOwe ? approx.youOwe : approx.owedToYou}
					tone={leadsWithOwe ? "default" : "positive"}
					value={lead}
				/>
				{note ? <TileNote>{note}</TileNote> : null}
			</HomeTile>,
		);
	}

	const dollar = glance.dollarToday;
	if (dollar) {
		const rate = dollar.rateType ? rateLabel(dollar.rateType) : null;
		const date = dollar.rateDate
			? t("tile.rateDate", { date: dates.short(dollar.rateDate) })
			: null;
		tiles.push(
			<HomeTile
				glyph="DollarSign"
				key="dollar"
				label={t("dollarToday")}
				onPress={() => router.push(currenciesHref())}
				spoken={[
					t("dollarToday"),
					dollar.value ? format(dollar.value, { display: "code" }) : noRate,
					rate,
					date,
				]
					.filter(Boolean)
					.join(", ")}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "baseline",
						gap: space[2],
					}}
				>
					<TileFigure code value={dollar.value} />
					{rate ? (
						<Text tone="fg3" variant="meta">
							{rate}
						</Text>
					) : null}
				</View>
				{date ? <TileNote>{date}</TileNote> : null}
			</HomeTile>,
		);
	}

	const worth = glance.netWorth.value;
	if (!isZero(worth)) {
		tiles.push(
			<HomeTile
				glyph="ChartLine"
				key="worth"
				label={t("netWorth")}
				onPress={() => router.push(wealthHref("home"))}
				spoken={`${t("netWorth")}, ${worth ? format(worth) : noRate}`}
			>
				<TileFigure value={worth} />
			</HomeTile>,
		);
	}

	const rows: ReactElement[][] = [];
	for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));

	return (
		<>
			<View style={{ paddingHorizontal: space[4], gap: space[3] }}>
				<HomeCard glance={glance} />
				<BudgetCard glance={glance} />
				{rows.map((row) => (
					<View
						key={isValidElement(row[0]) ? row[0].key : "row"}
						style={{ flexDirection: "row", gap: space[3] }}
					>
						{row}
						{row.length === 1 ? <View style={{ flex: 1 }} /> : null}
					</View>
				))}
			</View>
			<LinkButton
				label={t("insights")}
				onPress={() => router.push("/home/insights")}
			/>
		</>
	);
}
