import type { ReactNode } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { type Entered, minorOf } from "./amount";
import type { PreviewStatus } from "./useMoneyWrite";

/**
 * The scrolling body of a full-height sheet. The platform sheet centers short
 * content in its detent, so the body asks for most of the window's height and
 * the content starts at the top, where a form belongs.
 */
export function SheetBody({ children }: { children: ReactNode }) {
	const { height } = useWindowDimensions();
	const { space } = useTheme();
	return (
		<ScrollView
			contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
			keyboardShouldPersistTaps="handled"
			style={{ minHeight: height * SHEET_FILL }}
		>
			{children}
		</ScrollView>
	);
}

/** How much of the window a sheet body claims: enough to pin the top, short of the status bar. */
const SHEET_FILL = 0.8;

/** One plain sentence in a sheet, or an attention note when it needs the person. */
export function Note({
	children,
	tone = "plain",
}: {
	children: ReactNode;
	tone?: "plain" | "attention";
}) {
	const { color, type } = useTheme();
	return (
		<Text
			accessibilityRole={tone === "attention" ? "alert" : undefined}
			style={{
				color: tone === "attention" ? color.attentionText : color.fg2,
				fontSize: type.body.size,
			}}
		>
			{children}
		</Text>
	);
}

/** A label on the left and a figure on the right, right-aligned with tabular figures. */
export function Line({
	label,
	value,
	spoken,
	emphasis,
}: {
	label: string;
	value: string;
	/** What a screen reader says when the pair reads better as a sentence. */
	spoken?: string;
	emphasis?: boolean;
}) {
	const { color, font, space, type } = useTheme();
	return (
		<View
			accessibilityLabel={spoken ?? `${label}, ${value}`}
			accessible
			style={{
				flexDirection: "row",
				justifyContent: "space-between",
				gap: space[3],
				paddingVertical: space[1],
			}}
		>
			<Text
				style={{ flexShrink: 1, color: color.fg2, fontSize: type.body.size }}
			>
				{label}
			</Text>
			<Text
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					fontWeight: weight(
						emphasis ? font.weight.semibold : font.weight.normal,
					),
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</View>
	);
}

/**
 * The amount being typed and the keypad under it. The amount sits in a
 * bordered money input (R22): 44 high, the currency chip on the left, the
 * value at 16/500 on the right, never hero size. The text is the keypad's
 * (formatted by the domain package); the sheet reads it with `readAmount`.
 * The spoken label carries the amount as money, like the composer's.
 */
export function AmountField({
	currency,
	draft,
	onDraftChange,
	entered,
	label,
	allowZero,
	placeholder,
}: {
	currency: string;
	draft: string;
	onDraftChange: (draft: string) => void;
	entered: Entered;
	label: string;
	allowZero?: boolean;
	placeholder?: string;
}) {
	const t = useTranslations("mobile.composer");
	const tb = useTranslations("mobile.budget.write");
	const { format } = useFormatMoney();
	const { color, font, radius, size, space, type } = useTheme();
	const minor = minorOf(entered, allowZero);
	const invalid = entered.state === "invalid";
	const spoken =
		minor !== null
			? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: t("amountEmpty", { currency });
	return (
		<View style={{ gap: space[4] }}>
			<View style={{ gap: space[1] }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space[2],
						minHeight: size.moneyInput.phone,
						padding: space[1],
						backgroundColor: color.surface,
						borderWidth: 1,
						borderColor: invalid ? color.danger : color.lineStrong,
						borderRadius: radius.ctl,
					}}
				>
					<View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={{
							minHeight: size.ctl.phone,
							justifyContent: "center",
							paddingHorizontal: space[3],
							borderWidth: 1,
							borderColor: color.lineStrong,
							borderRadius: radius.chip,
						}}
					>
						<Text
							style={{
								color: color.fg2,
								fontSize: type.body.size,
								fontWeight: weight(font.weight.medium),
							}}
						>
							{currency}
						</Text>
					</View>
					<Text
						accessibilityLabel={`${label}, ${spoken}`}
						accessibilityLiveRegion="polite"
						adjustsFontSizeToFit
						numberOfLines={1}
						style={{
							flex: 1,
							paddingRight: space[2],
							color: draft ? color.fg : color.fg3,
							fontSize: type.section.size,
							fontVariant: ["tabular-nums"],
							fontWeight: weight(font.weight.medium),
							textAlign: "right",
						}}
					>
						{draft || placeholder || "0"}
					</Text>
				</View>
				{invalid ? (
					<Text
						accessibilityRole="alert"
						style={{
							color: color.danger,
							fontSize: type.small.size,
							textAlign: "right",
						}}
					>
						{tb("amountInvalid")}
					</Text>
				) : null}
			</View>
			<MoneyKeypad
				currency={currency}
				draft={draft}
				keyHeight={size.touchMin.phone}
				onDraftChange={onDraftChange}
			/>
		</View>
	);
}

/** A token weight (400, 500, 600) as the string React Native takes. */
function weight(value: number): "400" | "500" | "600" {
	return String(value) as "400" | "500" | "600";
}

export interface ChangeRow {
	key: string;
	label: string;
	value: string;
	spoken?: string;
}

/**
 * What the write would change and what it would not, from the server's dry
 * run (R30). Rows and names arrive worded; this lays them out like the web's
 * block: the figures that moved, then one sentence for what was checked and
 * stays, then one for what could not be checked (a missing rate). It says
 * "Checking" until the dry run is in, so Save never runs ahead of it.
 */
export function ChangeList({
	status,
	changes,
	stays,
	unavailable,
}: {
	status: PreviewStatus;
	changes: ChangeRow[];
	/** Names of the figures checked that stay as they are. */
	stays: string[];
	/** Names of the figures that could not be checked. */
	unavailable: string[];
}) {
	const t = useTranslations("mobile.budget.preview");
	const { color, font, space, type } = useTheme();
	if (status === "idle") return null;
	if (status === "loading") return <Note>{t("checking")}</Note>;
	if (status === "failed") return <Note tone="attention">{t("error")}</Note>;
	if (status === "refused") return <Note tone="attention">{t("refused")}</Note>;
	const keeps =
		stays.length === 0
			? null
			: changes.length === 0
				? t("noneChange", { list: stays.join(", ") })
				: stays.length === 1
					? t("nothingElseOne", { item: stays[0] ?? "" })
					: t("nothingElse", { list: stays.join(", ") });
	const missing =
		unavailable.length > 0
			? t("unavailable", { list: unavailable.join(", ") })
			: null;
	const closing = [keeps, missing].filter(Boolean).join(" ");
	return (
		<View
			style={{
				gap: space[2],
				paddingTop: space[3],
				borderTopWidth: 1,
				borderTopColor: color.line,
			}}
		>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontWeight: weight(font.weight.semibold),
				}}
			>
				{t("changes")}
			</Text>
			{changes.length > 0 ? (
				<View>
					{changes.map((row) => (
						<Line
							key={row.key}
							label={row.label}
							spoken={row.spoken}
							value={row.value}
						/>
					))}
				</View>
			) : keeps ? null : (
				<Note>{t("nothing")}</Note>
			)}
			{closing ? (
				<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
					{closing}
				</Text>
			) : null}
		</View>
	);
}

/** The locale the keypad and the amount reading use. */
export function useAmountLocale(): string {
	return useMoneyLocale();
}
