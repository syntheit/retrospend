import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { appBuild } from "@/lib/appVersion";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { EmptyState } from "@/ui/EmptyState";
import { ListRow, SectionHeader } from "@/ui/List";
import { Picker, type PickerOption } from "@/ui/Picker";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { openWebPage } from "./webPages";

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

/**
 * What a page shows while its read has not answered (rows in place), or when
 * it failed (the message and Retry).
 */
export function PageState({
	failed,
	onRetry,
}: {
	failed: boolean;
	onRetry: () => void;
}) {
	const t = useTranslations("mobile.settings");
	const tc = useTranslations("mobile.common");
	return (
		<Screen>
			{failed ? (
				<EmptyState
					actionLabel={tc("retry")}
					detail={t("errorDetail")}
					onAction={onRetry}
					title={t("error")}
				/>
			) : (
				<SkeletonRows />
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
	appearance,
}: {
	label: string;
	sub?: string;
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
	/** A wheel for a short run of numbers like a day of the month. */
	appearance?: "menu" | "wheel";
}) {
	return (
		<ListRow
			end={
				<Picker
					appearance={appearance}
					onChange={onChange}
					options={options}
					value={value}
				/>
			}
			sub={sub}
			title={
				<Text numberOfLines={2} weight="normal">
					{label}
				</Text>
			}
		/>
	);
}

/**
 * A settings row that picks a currency: the label, and the one currency
 * picker as a value row (flag, code, chevron in fg-2) like every other
 * value that opens a picker.
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
		<CurrencyPicker
			currencies={currencies}
			label={label}
			onChange={onChange}
			value={value}
			variant="row"
			yours={yours}
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
	const { space } = useTheme();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
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
				{t("version", appBuild())}
			</Text>
			<Text tone="fg3" variant="small">
				{t("license")}
			</Text>
			{baseUrl
				? pages.map((page) => (
						<TextAction
							key={page.id}
							label={page.label}
							link
							onPress={() => void openWebPage(baseUrl, page.path)}
							small
						/>
					))
				: null}
		</View>
	);
}
