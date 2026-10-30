import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { useSheetFill } from "@/ui/sheetContext";
import { Text } from "@/ui/Text";
import { type Entered, minorOf } from "./amount";
import type { PreviewStatus } from "./useMoneyWrite";

/**
 * The scrolling body of a sheet. It takes the room the sheet has between its
 * header and its pinned footer at the detent it rests at, starts at the top,
 * where a form belongs, and scrolls what does not fit (see useSheetFill).
 */
export function SheetBody({ children }: { children: ReactNode }) {
	const fill = useSheetFill();
	const { space } = useTheme();
	return (
		<ScrollView
			contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
			keyboardShouldPersistTaps="handled"
			style={fill}
		>
			{children}
		</ScrollView>
	);
}

/** One plain sentence in a sheet, or an attention note when it needs the person. */
export function Note({
	children,
	tone = "plain",
}: {
	children: ReactNode;
	tone?: "plain" | "attention";
}) {
	return (
		<Text
			accessibilityRole={tone === "attention" ? "alert" : undefined}
			tone={tone === "attention" ? "attention" : "fg2"}
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
	const { space } = useTheme();
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
			<Text style={{ flexShrink: 1 }} tone="fg2">
				{label}
			</Text>
			<Text
				style={{ textAlign: "right" }}
				tabular
				weight={emphasis ? "semibold" : "normal"}
			>
				{value}
			</Text>
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
	const { color, space } = useTheme();
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
			<Text accessibilityRole="header" weight="semibold">
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
				<Text tone="fg3" variant="meta">
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
