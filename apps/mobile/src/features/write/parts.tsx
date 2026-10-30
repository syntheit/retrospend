import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { useSheetFill } from "@/ui/sheetContext";
import { Text } from "@/ui/Text";

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

/** The figure row of a preview; it lives with the one ChangeList in `ui`. */
export { Line } from "@/ui/ChangeList";

/** The locale the keypad and the amount reading use. */
export function useAmountLocale(): string {
	return useMoneyLocale();
}
