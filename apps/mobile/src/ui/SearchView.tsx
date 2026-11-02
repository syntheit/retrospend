import {
	type ComponentRef,
	type ReactNode,
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { BackHandler, StyleSheet, TextInput, View } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { NoBar } from "./barScroll";
import { easeLand, easeLeave } from "./motion";
import { typeStyle } from "./Text";
import { TopBarAction } from "./TopBarAction";

/**
 * The Material 3 expanded search view, full screen over a tab root (Android):
 * the back arrow, the field with a clear mark once there is text, and under
 * them the results, which are the screen's own list with the query applied,
 * so the groups, rows and money are the ones the list shows. The arrow and the
 * system Back both close it and clear the query. It fades in (state
 * duration), opacity only, so reduced motion needs no other path.
 *
 * The page stays under it, so a result that opens a page pushes it over the
 * view, and Back returns to the view with its query.
 */
export function SearchView({
	open,
	value,
	onChange,
	onClose,
	placeholder,
	commands,
	children,
}: {
	open: boolean;
	value: string;
	onChange: (text: string) => void;
	onClose: () => void;
	placeholder: string;
	/** What Cmd+F reaches: the same handle the system search bar gives. */
	commands?: Ref<SearchBarCommands | null>;
	children: ReactNode;
}) {
	const t = useTranslations("mobile.pickers");
	const tc = useTranslations("mobile.common");
	const theme = useTheme();
	const { color, duration, space } = theme;
	const { top } = useSafeAreaInsets();
	const input = useRef<ComponentRef<typeof TextInput>>(null);
	useImperativeHandle(
		commands,
		() =>
			({
				focus: () => input.current?.focus(),
				blur: () => input.current?.blur(),
				clearText: () => onChange(""),
				setText: (text: string) => onChange(text),
				cancelSearch: onClose,
				toggleCancelButton: () => {},
			}) as SearchBarCommands,
		[onChange, onClose],
	);
	// The system Back closes the view first, the page behind it second.
	useEffect(() => {
		if (!open) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			onClose();
			return true;
		});
		return () => sub.remove();
	}, [open, onClose]);
	if (!open) return null;
	return (
		<Animated.View
			entering={FadeIn.duration(duration.state)
				.easing(easeLand(theme))
				.reduceMotion(ReduceMotion.Never)}
			exiting={FadeOut.duration(duration.state)
				.easing(easeLeave(theme))
				.reduceMotion(ReduceMotion.Never)}
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				zIndex: 5,
				backgroundColor: color.bg,
			}}
		>
			<View
				style={{
					paddingTop: top,
					backgroundColor: color.surface,
					borderBottomWidth: StyleSheet.hairlineWidth,
					borderBottomColor: color.line,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						height: space[12] + space[6],
						paddingHorizontal: space[2],
						gap: space[2],
					}}
				>
					<TopBarAction
						icon="ArrowLeft"
						id="search-back"
						label={tc("back")}
						onPress={onClose}
					/>
					<TextInput
						accessibilityLabel={placeholder}
						autoCapitalize="none"
						autoCorrect={false}
						autoFocus
						cursorColor={color.brand}
						onChangeText={onChange}
						placeholder={placeholder}
						placeholderTextColor={color.fg3}
						ref={input}
						returnKeyType="search"
						style={[
							typeStyle(theme, "section", { weight: "normal" }),
							{ flex: 1, minWidth: 0, color: color.fg },
						]}
						value={value}
					/>
					{value ? (
						<TopBarAction
							icon="X"
							id="search-clear"
							label={t("clear")}
							onPress={() => {
								onChange("");
								input.current?.focus();
							}}
						/>
					) : null}
				</View>
			</View>
			<View style={{ flex: 1 }}>
				<NoBar>{children}</NoBar>
			</View>
		</Animated.View>
	);
}
