import { categoryIconName } from "@retrospend/domain/category-icons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { categoryColor, Glyph, type GlyphName } from "@/ui/Glyph";

/** A section title with the count or action at its end. Flat, no card. */
export function SectionHeader({
	title,
	detail,
	actionLabel,
	onAction,
}: {
	title: string;
	detail?: string;
	actionLabel?: string;
	onAction?: () => void;
}) {
	const { color, size, space, type } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "baseline",
				justifyContent: "space-between",
				paddingHorizontal: space[4],
				paddingTop: space[6],
				paddingBottom: space[2],
			}}
		>
			<View
				style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}
			>
				<Text
					accessibilityRole="header"
					style={{
						color: color.fg,
						fontSize: type.section.size,
						fontWeight: "600",
					}}
				>
					{title}
				</Text>
				{detail ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{detail}
					</Text>
				) : null}
			</View>
			{actionLabel && onAction ? (
				<Pressable
					accessibilityRole="button"
					hitSlop={(size.touchMin.phone - type.body.size) / 2}
					onPress={onAction}
				>
					<Text
						style={{
							color: color.brand,
							fontSize: type.body.size,
							fontWeight: "500",
						}}
					>
						{actionLabel}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

/** Said when the screen shows what the phone kept, because the server did not answer. */
export function StaleNote({ since }: { since: string | null }) {
	const t = useTranslations("mobile.activity");
	const format = useFormatter();
	const { color, space, type } = useTheme();
	if (!since) return null;
	return (
		<Text
			style={{
				color: color.fg2,
				fontSize: type.small.size,
				paddingHorizontal: space[4],
				paddingVertical: space[2],
			}}
		>
			{t("offlineSince", {
				time: format.dateTime(new Date(since), {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			})}
		</Text>
	);
}

/** The category a row names: its icon key and its color slot (1 to 21). */
export interface CategoryRef {
	name: string | null;
	icon: string | null;
	tone: number;
}

/**
 * The category as a tinted tile with its glyph, on its own category color.
 * It says only "which category" (GUIDELINE 2.1) and sits in list rows only;
 * pickers and menus show the bare glyph. A row with no category gets the
 * neutral tile and `fallback` (a payment is a banknote).
 */
export function CategoryTile({
	category,
	fallback = "Tag",
}: {
	category: CategoryRef | null;
	fallback?: GlyphName;
}) {
	const { color, radius, size } = useTheme();
	const base = category ? categoryColor(color, category.tone) : color.fg3;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size.avatar.default,
				height: size.avatar.default,
				borderRadius: radius.ctl,
				backgroundColor: `${base}26`,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Glyph
				color={base}
				name={
					category?.name || category?.icon
						? categoryIconName(category.name ?? "", category.icon)
						: fallback
				}
				size={size.icon.phone}
			/>
		</View>
	);
}

/** A tappable list row at the 44pt minimum, with a hairline under it. */
export function ListRow({
	children,
	onPress,
	selected,
	accessibilityLabel,
}: {
	children: ReactNode;
	onPress?: () => void;
	selected?: boolean;
	accessibilityLabel?: string;
}) {
	const { color, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole={onPress ? "button" : undefined}
			accessibilityState={selected ? { selected: true } : undefined}
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.row.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				paddingHorizontal: space[4],
				paddingVertical: space[2],
				backgroundColor: pressed || selected ? color.raised : color.bg,
				borderBottomWidth: 1,
				borderBottomColor: color.line,
			})}
		>
			{children}
		</Pressable>
	);
}

/** A text button on its own line (Show more, Show fewer), at the 44pt minimum. */
export function LinkButton({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	const { color, size, space, type } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={{
				minHeight: size.touchMin.phone,
				justifyContent: "center",
				paddingHorizontal: space[4],
			}}
		>
			<Text
				style={{
					color: color.brand,
					fontSize: type.body.size,
					fontWeight: "500",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}
