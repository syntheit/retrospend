import {
	type ComponentRef,
	type ReactNode,
	type Ref,
	useImperativeHandle,
	useRef,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";

/**
 * The title row of one pane in a list-detail pair. The native navigation bar
 * spans the whole window, so on iPad and wide Android windows each pane draws
 * its own bar: the list's title and toolbar over the list, the detail's title
 * over the detail.
 */
export function PaneBar({
	title,
	trailing,
}: {
	title: string;
	trailing?: ReactNode;
}) {
	const { color, space, size, type } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				minHeight: size.touchMin.phone,
				gap: space[2],
				paddingHorizontal: space[4],
				paddingTop: space[2],
				paddingBottom: space[2],
				backgroundColor: color.bg,
			}}
		>
			<Text
				accessibilityRole="header"
				numberOfLines={1}
				style={{
					flex: 1,
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{title}
			</Text>
			{trailing}
		</View>
	);
}

/**
 * The list pane's search field, the stand-in for the native search bar (which
 * belongs to the window-wide navigation bar). Cmd+F reaches it through the
 * same ref the native bar would take.
 */
export function PaneSearch({
	value,
	onChange,
	placeholder,
	searchRef,
}: {
	value: string;
	onChange: (text: string) => void;
	placeholder: string;
	searchRef?: Ref<SearchBarCommands | null>;
}) {
	const t = useTranslations("mobile.pickers");
	const { color, space, size, radius, type } = useTheme();
	const input = useRef<ComponentRef<typeof TextInput>>(null);
	useImperativeHandle(
		searchRef,
		() =>
			({
				focus: () => input.current?.focus(),
				blur: () => input.current?.blur(),
				clearText: () => onChange(""),
				setText: (text: string) => onChange(text),
				cancelSearch: () => onChange(""),
				toggleCancelButton: () => {},
			}) as SearchBarCommands,
		[onChange],
	);
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				minHeight: size.touchMin.phone,
				gap: space[2],
				marginHorizontal: space[4],
				marginBottom: space[2],
				paddingLeft: space[3],
				borderRadius: radius.ctl,
				backgroundColor: color.raised,
			}}
		>
			<Glyph color={color.fg2} name="Search" size={size.icon.phone} />
			<TextInput
				accessibilityLabel={placeholder}
				autoCapitalize="none"
				autoCorrect={false}
				onChangeText={onChange}
				placeholder={placeholder}
				placeholderTextColor={color.fg3}
				ref={input}
				returnKeyType="search"
				style={{
					flex: 1,
					minHeight: size.touchMin.phone,
					color: color.fg,
					fontSize: type.body.size,
				}}
				value={value}
			/>
			{value ? (
				<Pressable
					accessibilityLabel={t("clear")}
					accessibilityRole="button"
					onPress={() => onChange("")}
					style={{
						width: size.touchMin.phone,
						height: size.touchMin.phone,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Glyph color={color.fg2} name="X" size={size.icon.phone} />
				</Pressable>
			) : null}
		</View>
	);
}
