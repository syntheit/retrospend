import type { ReactNode } from "react";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickRow } from "@/ui/pickGroups";
import { Chip } from "./Chip";
import { FieldLabel } from "./ExpenseFields";

/**
 * A labeled choice from a list: a chip with the picked row's identity and
 * name, and the picker sheet behind it (GUIDELINE 8: pickers carry identity).
 * `none` adds a first row that clears the choice.
 */
export function PickField({
	label,
	title,
	find,
	empty,
	rows,
	value,
	none,
	onChange,
}: {
	label: string;
	title: string;
	find: string;
	empty: string;
	rows: Omit<PickRow, "selected">[];
	value: string | null;
	none?: { label: string; lead: ReactNode };
	onChange: (id: string | null) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const { space } = useTheme();
	const [open, setOpen] = useState(false);
	const picked = rows.find((r) => r.id === value);
	const shown = picked ?? none;
	const NONE = "";
	const all = [
		...(none ? [{ id: NONE, label: none.label, lead: none.lead }] : []),
		...rows,
	].map((r) => ({ ...r, selected: (value ?? NONE) === r.id }));
	return (
		<View style={{ gap: space[2] }}>
			<FieldLabel>{label}</FieldLabel>
			<View style={{ flexDirection: "row" }}>
				<Chip
					accessibilityLabel={`${label}, ${shown?.label ?? ""}`}
					label={shown?.label ?? ""}
					leading={shown?.lead}
					onPress={() => setOpen(true)}
					selected
				/>
			</View>
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
		</View>
	);
}
