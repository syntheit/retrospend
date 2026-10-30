import Constants from "expo-constants";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { EmptyState } from "@/ui/EmptyState";
import { Glyph } from "@/ui/Glyph";
import { ListRow, SectionHeader } from "@/ui/List";
import { Picker, type PickerOption } from "@/ui/Picker";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { openWebPage } from "./webPages";

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
 * on the left, the system menu picker at the end. A change saves at once. A
 * long label wraps to a second line instead of cutting off.
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
			title={
				<Text numberOfLines={2} weight="medium">
					{label}
				</Text>
			}
		/>
	);
}

/**
 * A settings row that picks a currency: the label, and the one currency
 * picker (flag, code, chevron) at the end.
 */
export function CurrencyRow({
	label,
	currencies,
	yours,
	value,
	onChange,
}: {
	label: string;
	currencies: string[];
	yours: string[];
	value: string;
	onChange: (code: string) => void;
}) {
	return (
		<ListRow
			end={
				<CurrencyPicker
					currencies={currencies}
					label={label}
					onChange={onChange}
					value={value}
					yours={yours}
				/>
			}
			title={
				<Text numberOfLines={2} weight="medium">
					{label}
				</Text>
			}
		/>
	);
}

/**
 * The quiet footer of the Settings list: the version, the license and the
 * two legal pages, which open on the connected server.
 */
export function AboutFooter() {
	const t = useTranslations("mobile.settings.about");
	const { connection } = useServerConnection();
	const { color, size, space } = useTheme();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const version = Constants.expoConfig?.version ?? "";
	const pages = [
		{ id: "privacy", label: t("privacy"), path: "/privacy" },
		{ id: "terms", label: t("terms"), path: "/terms" },
	] as const;
	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				columnGap: space[4],
				paddingHorizontal: space[4],
				paddingTop: space[6],
			}}
		>
			<Text tone="fg3" variant="small">
				{t("version", { version })}
			</Text>
			<Text tone="fg3" variant="small">
				{t("license")}
			</Text>
			{baseUrl
				? pages.map((page) => (
						<Pressable
							accessibilityRole="link"
							key={page.id}
							onPress={() => void openWebPage(baseUrl, page.path)}
							style={{
								minHeight: size.touchMin.phone,
								justifyContent: "center",
							}}
						>
							<Text style={{ color: color.fg3 }} variant="small">
								{page.label}
							</Text>
						</Pressable>
					))
				: null}
		</View>
	);
}
