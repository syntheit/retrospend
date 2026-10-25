import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { useTranslations } from "use-intl";
import { EntryComposer } from "@/features/entry/EntryComposer";
import { useTheme } from "@/theme";

/**
 * The iPhone's Add tab: the composer, anchored to the bottom with the keypad
 * under your thumb. Android and iPad open the same composer as a sheet from
 * the AddEntryProvider instead, so this screen is only reached on iPhone.
 */
export default function AddScreen() {
	const t = useTranslations("mobile.entry");
	const router = useRouter();
	const { color, size, space, type } = useTheme();
	const { mode } = useLocalSearchParams<{ mode?: string }>();
	const leave = () => router.navigate("/home");

	return (
		<>
			<Stack.Screen
				options={{
					title: t("titleExpense"),
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
				initialMode={mode === "income" ? "income" : "expense"}
				onDone={leave}
			/>
		</>
	);
}
