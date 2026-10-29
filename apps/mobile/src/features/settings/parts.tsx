import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Glyph } from "@/ui/Glyph";
import { ListRow, SectionHeader } from "@/ui/List";
import { Picker, type PickerOption } from "@/ui/Picker";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** The end of a navigating row: its value in fg-2, then the chevron. */
export function NavEnd({ value }: { value?: string }) {
	const { color, size, space } = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
			{value ? (
				<Text numberOfLines={1} style={{ flexShrink: 1 }} tone="fg2">
					{value}
				</Text>
			) : null}
			<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
		</View>
	);
}

/** One quiet sentence under a group, for what its rows cannot say. */
export function GroupNote({ children }: { children: ReactNode }) {
	const { space } = useTheme();
	return (
		<Text
			style={{ paddingHorizontal: space[4], paddingTop: space[2] }}
			tone="fg3"
			variant="small"
		>
			{children}
		</Text>
	);
}

/** A titled run of groups: the heading, then what belongs under it. */
export function Block({
	title,
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	return (
		<>
			{title ? <SectionHeader title={title} /> : null}
			{children}
		</>
	);
}

/** A settings page: the scrolling body on the page color, with room above the first group. */
export function SettingsPage({ children }: { children: ReactNode }) {
	const { space } = useTheme();
	return (
		<Screen flush>
			<View style={{ paddingTop: space[2] }} />
			{children}
		</Screen>
	);
}

/** What a page shows while its read has not answered, or when it failed. */
export function PageState({ failed }: { failed: boolean }) {
	const t = useTranslations("mobile.settings");
	return (
		<Screen>
			{failed ? (
				<EmptyState detail={t("errorDetail")} title={t("error")} />
			) : (
				<EmptyState title="" />
			)}
		</Screen>
	);
}

/**
 * A setting with a menu of choices: the label (and what it means, under it)
 * on the left, the system menu picker at the end. A change saves at once.
 */
export function PickerRow<T extends string>({
	label,
	sub,
	options,
	value,
	onChange,
}: {
	label: string;
	sub?: string;
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<ListRow
			end={<Picker onChange={onChange} options={options} value={value} />}
			sub={sub}
			title={label}
		/>
	);
}
