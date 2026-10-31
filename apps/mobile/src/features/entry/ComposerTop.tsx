import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import type { MenuItem } from "@/ui/types";
import type { EntryMode } from "./ComposerShell";

/**
 * The head of the composer: Cancel at the start and, at the end, the choice
 * between Expense, Income and Transfer. A saved expense has no choice: its
 * title stands there, and the actions menu (Undo changes, Delete) sits at the
 * end.
 */
export function ComposerTop({
	mode,
	modes,
	onModeChange,
	onCancel,
	editing,
	actions,
}: {
	mode: EntryMode;
	/** The modes to pick between; fewer than two shows none (an edit). */
	modes: EntryMode[];
	onModeChange: (mode: EntryMode) => void;
	onCancel: () => void;
	editing: boolean;
	/** What the menu at the end holds; none shows no menu. */
	actions: MenuItem[];
}) {
	const t = useTranslations("mobile.composer");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[2],
			}}
		>
			<TextAction label={tc("cancel")} onPress={onCancel} />
			{editing ? (
				<Text
					accessibilityRole="header"
					numberOfLines={1}
					style={{ flex: 1, textAlign: "center" }}
					variant="section"
				>
					{t("titleEdit")}
				</Text>
			) : modes.length > 1 ? (
				// The M3 segmented button draws its outline past its box.
				// iOS draws it as wide as its words, at the end; Android fills what it is given.
				<View
					style={{
						flex: 1,
						alignItems: Platform.OS === "ios" ? "flex-end" : "stretch",
						paddingVertical: space[1],
					}}
				>
					<Segmented
						accessibilityLabel={t("mode")}
						onChange={onModeChange}
						options={modes.map((value) => ({
							value,
							label: t(value === "transfer" ? "transferMode" : value),
						}))}
						value={mode}
					/>
				</View>
			) : null}
			{editing ? (
				actions.length > 0 ? (
					<Menu
						accessibilityLabel={t("actions")}
						icon
						items={actions}
						label={t("actions")}
					/>
				) : (
					<View />
				)
			) : null}
		</View>
	);
}
