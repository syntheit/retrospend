import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import type { EntryMode } from "./ComposerShell";

/**
 * The composer's head. The quick step has the mode row centered over one
 * line: the context pill (Personal or the project; an edit has the actions
 * menu there) at the start and More at the end. More has its own title. An
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
	editing,
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
	/** An edit: the sheet's own title says it, so More adds none. */
	editing: boolean;
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
				{editing ? null : (
					<Text accessibilityRole="header" variant="section">
						{t("moreDetails")}
					</Text>
				)}
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
					justifyContent: "space-between",
					gap: space[2],
				}}
			>
				{/* The context pill sits at the leading edge; an edit has the actions there. */}
				<View style={{ flexShrink: 1, alignItems: "flex-start" }}>
					{actions ?? context}
				</View>
				<Chip
					accessibilityLabel={t("more")}
					chevron="right"
					label={t("more")}
					onPress={onMore}
					variant="trigger"
				/>
			</View>
		</View>
	);
}
