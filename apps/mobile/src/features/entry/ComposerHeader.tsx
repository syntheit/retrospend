import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { TextAction } from "@/features/activity/TextAction";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import type { EntryMode } from "./ComposerShell";

/**
 * The composer's head. The quick step has the mode row centered over one
 * line: the actions menu at the start, the context pill (Personal or the
 * project) in the middle and More at the end. More has its own title. An
 * edit has no mode row, and its menu holds Undo changes.
 */
export function ComposerHeader({
	step,
	mode,
	modes,
	onModeChange,
	context,
	onMore,
	undoChanges,
}: {
	step: "quick" | "more";
	mode: EntryMode;
	/** The modes to pick between; fewer than two hides the row (an edit). */
	modes: EntryMode[];
	onModeChange: (mode: EntryMode) => void;
	/** The context pill; only an expense you add has one. */
	context: ReactNode;
	onMore: () => void;
	/** Puts every field back as it was opened; null while nothing changed. */
	undoChanges: (() => void) | null;
}) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const actions = undoChanges ? (
		<Menu
			accessibilityLabel={t("actions")}
			items={[{ id: "undo", label: t("undoChanges"), onPress: undoChanges }]}
			label={t("actionsLabel")}
		/>
	) : null;
	if (step === "more") {
		return (
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[2],
				}}
			>
				<Text accessibilityRole="header" variant="section">
					{t("moreDetails")}
				</Text>
				{actions}
			</View>
		);
	}
	return (
		<View style={{ gap: space[2] }}>
			{/* The M3 segmented button draws its outline past its box. */}
			{modes.length > 1 ? (
				<View style={{ alignItems: "center", paddingVertical: space[1] }}>
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
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[2],
				}}
			>
				<View style={{ flex: 1, alignItems: "flex-start" }}>{actions}</View>
				{context}
				<View style={{ flex: 1, alignItems: "flex-end" }}>
					<TextAction label={t("more")} onPress={onMore} />
				</View>
			</View>
		</View>
	);
}
