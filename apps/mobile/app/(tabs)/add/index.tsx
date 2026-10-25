import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { EntryMode } from "@/features/entry/ComposerShell";
import { EntryComposer } from "@/features/entry/EntryComposer";
import { useTheme } from "@/theme";

/** The floating tab bar's height above the home indicator. */
const TAB_BAR = 49;

/**
 * The iPhone's Add tab: the composer, anchored to the bottom with the keypad
 * under your thumb. Android and iPad open the same composer as a sheet from
 * the AddEntryProvider instead, so this screen is only reached on iPhone.
 */
export default function AddScreen() {
	const t = useTranslations("mobile.entry");
	const router = useRouter();
	const { color, size, space, type } = useTheme();
	const insets = useSafeAreaInsets();
	const { mode } = useLocalSearchParams<{ mode?: string }>();
	const [current, setCurrent] = useState<EntryMode>(
		mode === "income" ? "income" : "expense",
	);
	const leave = () => router.navigate("/home");

	return (
		<>
			<Stack.Screen
				options={{
					title: current === "income" ? t("titleIncome") : t("titleExpense"),
					headerLargeTitle: false,
					headerLeft: () => (
						<Pressable
							accessibilityRole="button"
							hitSlop={space[2]}
							onPress={leave}
							style={{
								minHeight: size.touchMin.phone,
								justifyContent: "center",
							}}
						>
							<Text style={{ color: color.fg, fontSize: type.section.size }}>
								{t("cancel")}
							</Text>
						</Pressable>
					),
				}}
			/>
			<EntryComposer
				bottomInset={insets.bottom + TAB_BAR}
				initialMode={mode === "income" ? "income" : "expense"}
				onModeChange={setCurrent}
				onDone={leave}
			/>
		</>
	);
}
