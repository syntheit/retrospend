import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import { FieldError } from "@/ui/TextField";
import type { MoneyLine } from "./AmountCard";

/**
 * The amount, big and centered: the currency (its picker, or the plain code
 * when it comes from an account) and the figure at the hero size, with the
 * rate line under it for another currency. While the keypad is folded the
 * block sits on a raised background and is a button that brings the keypad
 * back; while the keypad is open the figure is still the target, so tapping
 * it keeps the keys on the amount (and not on a part of a split).
 */
export function AmountBlock({
	line,
	folded,
	error,
	below,
	onPress,
}: {
	line: MoneyLine;
	/** The keypad is folded: the block is raised. */
	folded: boolean;
	/** Add was pressed with no amount. */
	error: boolean;
	/** The rate line for another currency. */
	below?: ReactNode;
	/** Brings the keys back on the amount. */
	onPress: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const { color, radius, size, space } = useTheme();
	return (
		<View style={{ gap: space[1] }}>
			<View
				style={{
					minHeight: size.touchMin.phone + space[4],
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: space[2],
					paddingHorizontal: space[3],
					borderRadius: radius.panel,
					borderWidth: 1,
					borderColor: error ? color.danger : "transparent",
					backgroundColor: folded ? color.raised : "transparent",
				}}
			>
				{line.currency}
				<Pressable
					accessibilityHint={folded ? t("showKeypad") : undefined}
					accessibilityLabel={line.spoken}
					accessibilityRole="button"
					onPress={onPress}
					style={{
						flexShrink: 1,
						minHeight: size.touchMin.phone,
						justifyContent: "center",
					}}
				>
					<Text
						accessibilityLiveRegion="polite"
						adjustsFontSizeToFit
						numberOfLines={1}
						tabular
						tone={line.text ? "fg" : "fg3"}
						variant="hero"
						weight="medium"
					>
						{line.text || line.placeholder}
					</Text>
				</Pressable>
			</View>
			{error ? (
				<View style={{ alignItems: "center" }}>
					<FieldError>{t("errors.amount")}</FieldError>
				</View>
			) : null}
			{below}
		</View>
	);
}
