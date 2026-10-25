import type { ReactNode } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatLocale } from "@/lib/intl";
import { useFormatMoney } from "@/lib/money";
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
	const { color, space, type } = useTheme();
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
					fontWeight: emphasis ? "600" : "400",
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</View>
	);
}

/**
 * The amount being typed and the keypad under it. The text is the keypad's
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
	const { color, size, space, type } = useTheme();
	const minor = minorOf(entered, allowZero);
	const spoken =
		minor !== null
			? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: t("amountEmpty", { currency });
	return (
		<View style={{ gap: space[2] }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[3],
					minHeight: size.moneyInput.phone,
				}}
			>
				<Text style={{ color: color.fg2, fontSize: type.section.size }}>
					{currency}
				</Text>
				<Text
					accessibilityLabel={`${label}, ${spoken}`}
					accessibilityLiveRegion="polite"
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						flex: 1,
						color: draft ? color.fg : color.fg3,
						fontSize: type.hero.size,
						fontVariant: ["tabular-nums"],
						fontWeight: "600",
						textAlign: "right",
					}}
				>
					{draft || placeholder || "0"}
				</Text>
			</View>
			{entered.state === "invalid" ? (
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
			<MoneyKeypad
				currency={currency}
				draft={draft}
				keyHeight={size.touchMin.phone}
				onDraftChange={onDraftChange}
			/>
		</View>
	);
}

export interface ChangeRow {
	key: string;
	label: string;
	value: string;
	spoken?: string;
}

/**
 * What the write would change and what it would not, from the server's dry
 * run (R30). Rows arrive worded; this only lays them out and says "Checking"
 * until the dry run is in, so Save never runs ahead of it.
 */
export function ChangeList({
	status,
	changes,
	stays,
	nothing,
}: {
	status: PreviewStatus;
	changes: ChangeRow[];
	stays: ChangeRow[];
	/** The dry run came back and the write would change nothing. */
	nothing?: string;
}) {
	const t = useTranslations("mobile.budget.preview");
	const { color, space, type } = useTheme();
	if (status === "idle") return null;
	if (status === "loading") return <Note>{t("checking")}</Note>;
	if (status === "failed") return <Note tone="attention">{t("error")}</Note>;
	if (status === "refused") return <Note tone="attention">{t("refused")}</Note>;
	const heading = (text: string) => (
		<Text
			accessibilityRole="header"
			style={{
				color: color.fg2,
				fontSize: type.small.size,
				fontWeight: "600",
			}}
		>
			{text}
		</Text>
	);
	return (
		<View style={{ gap: space[3] }}>
			{changes.length > 0 ? (
				<View>
					{heading(t("changes"))}
					{changes.map((row) => (
						<Line
							key={row.key}
							label={row.label}
							spoken={row.spoken}
							value={row.value}
						/>
					))}
				</View>
			) : nothing ? (
				<Note>{nothing}</Note>
			) : null}
			{stays.length > 0 ? (
				<View>
					{heading(t("stays"))}
					{stays.map((row) => (
						<Line
							key={row.key}
							label={row.label}
							spoken={row.spoken}
							value={row.value}
						/>
					))}
				</View>
			) : null}
		</View>
	);
}

/** The locale the keypad and the amount reading use. */
export function useAmountLocale(): string {
	return useFormatLocale();
}
