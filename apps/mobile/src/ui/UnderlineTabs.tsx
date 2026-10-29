import { Platform, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "./Text";

export interface UnderlineTab<T extends string> {
	value: T;
	label: string;
}

/**
 * The page tabs of the mockups (People and Projects, a project's Expenses,
 * Summary and People): a row of labels on one hairline, the open one in fg at
 * 600 with a 2 point accent underline, the others in fg-2 at 500. It switches
 * the content under it, so it is for pages; a choice inside a form stays the
 * segmented control. Each tab is 44 points tall (the touch target), a press
 * ripples on Android and dims on iOS, and a screen reader hears a tab list
 * with the open one selected. The row scrolls sideways when its labels do not
 * fit.
 */
export function UnderlineTabs<T extends string>({
	tabs,
	value,
	onChange,
	accessibilityLabel,
}: {
	tabs: UnderlineTab<T>[];
	value: T;
	onChange: (value: T) => void;
	accessibilityLabel: string;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View
			style={{
				borderBottomWidth: 1,
				borderBottomColor: color.line,
				marginHorizontal: size.gutter.phone,
			}}
		>
			<ScrollView
				accessibilityLabel={accessibilityLabel}
				accessibilityRole="tablist"
				contentContainerStyle={{ gap: space[6] }}
				horizontal
				showsHorizontalScrollIndicator={false}
			>
				{tabs.map((tab) => {
					const on = tab.value === value;
					return (
						<Pressable
							accessibilityRole="tab"
							accessibilityState={{ selected: on }}
							android_ripple={{ color: color.raised }}
							key={tab.value}
							onPress={() => onChange(tab.value)}
							style={({ pressed }) => ({
								minHeight: size.touchMin.phone,
								justifyContent: "center",
								backgroundColor:
									Platform.OS === "ios" && pressed
										? color.raised
										: "transparent",
							})}
						>
							<Text
								numberOfLines={1}
								tone={on ? "fg" : "fg2"}
								weight={on ? "semibold" : "medium"}
							>
								{tab.label}
							</Text>
							<View
								style={{
									position: "absolute",
									left: 0,
									right: 0,
									bottom: 0,
									height: space[1] / 2,
									borderRadius: radius.chip,
									backgroundColor: on ? color.accent : "transparent",
								}}
							/>
						</Pressable>
					);
				})}
			</ScrollView>
		</View>
	);
}
