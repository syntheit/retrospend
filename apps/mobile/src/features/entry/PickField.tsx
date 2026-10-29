import type { ReactNode } from "react";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Glyph } from "@/ui/Glyph";
import { ListRow } from "@/ui/List";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickRow } from "@/ui/pickGroups";
import { Text } from "@/ui/Text";

/**
 * A choice from a list, in two looks over the one picker sheet
 * (GUIDELINE 8: pickers carry identity):
 * - `pill`: a trigger chip with the picked row's identity and name, for the
 *   composer's header (Personal or a project).
 * - `row`: a list row inside an inset group, its name on the left and the
 *   pick (identity, name, chevron) on the right.
 * `none` adds a first row that clears the choice; while nothing is picked the
 * pill or row says `none.shown`.
 */
export function PickField({
	variant = "row",
	label,
	title,
	find,
	empty,
	rows,
	value,
	none,
	onChange,
}: {
	variant?: "pill" | "row";
	label: string;
	title: string;
	find: string;
	empty: string;
	rows: Omit<PickRow, "selected">[];
	value: string | null;
	/** `label` is the picker row; `shown` is what the pill or row says while nothing is picked. */
	none?: { label: string; shown?: string; lead: ReactNode };
	onChange: (id: string | null) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const { color, size, space } = useTheme();
	const [open, setOpen] = useState(false);
	const picked = rows.find((r) => r.id === value);
	const shown = picked
		? { text: picked.label, lead: picked.lead }
		: none
			? { text: none.shown ?? none.label, lead: none.lead }
			: { text: "", lead: null };
	const NONE = "";
	const all = [
		...(none ? [{ id: NONE, label: none.label, lead: none.lead }] : []),
		...rows,
	].map((r) => ({ ...r, selected: (value ?? NONE) === r.id }));
	const spoken = `${label}, ${shown.text}`;
	return (
		<>
			{variant === "pill" ? (
				<Chip
					accessibilityLabel={spoken}
					label={shown.text}
					leading={shown.lead}
					onPress={() => setOpen(true)}
					variant="trigger"
				/>
			) : (
				<ListRow
					accessibilityLabel={spoken}
					end={
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space[2],
							}}
						>
							{shown.lead}
							<Text numberOfLines={1} tone="fg2">
								{shown.text}
							</Text>
							<Glyph
								color={color.fg3}
								name="ChevronRight"
								size={size.icon.phone}
							/>
						</View>
					}
					onPress={() => setOpen(true)}
					title={label}
				/>
			)}
			<PickerSheet
				clear={t("clear")}
				empty={empty}
				find={find}
				groups={[{ key: "all", heading: title, rows: all }]}
				onClose={() => setOpen(false)}
				onSelect={(id) => onChange(id === NONE ? null : id)}
				title={title}
				visible={open}
			/>
		</>
	);
}
