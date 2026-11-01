import type { ReactNode } from "react";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "./Chip";
import { PickerSheet } from "./PickerSheet";
import { PickField } from "./PickField";
import type { PickRow } from "./pickGroups";
import { FieldLabel } from "./TextField";

/**
 * The form fields of a choice, over the one picker sheet: the label above, then
 * the trigger (identity, name) that opens the sheet with its search field.
 */

/** A form field: the label above its trigger, flush left. */
export function PickLabeled({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[2], alignItems: "flex-start" }}>
			<FieldLabel>{label}</FieldLabel>
			{children}
		</View>
	);
}

/** Pick one of a few named options with no identity (a budget group). */
export function GroupPick({
	label,
	groups,
	value,
	onChange,
}: {
	label: string;
	groups: readonly { id: string; label: string }[];
	value: string;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("mobile.budget.pick");
	return (
		<PickLabeled label={label}>
			<PickField
				empty={t("groupEmpty")}
				find={t("groupFind")}
				label={label}
				onChange={(id) => id !== null && onChange(id)}
				rows={groups.map((g) => ({ id: g.id, label: g.label, lead: null }))}
				title={label}
				value={value}
				variant="pill"
			/>
		</PickLabeled>
	);
}

/**
 * Pick several from a list: a trigger that says how many, and the picker
 * sheet in its multiple mode (a check per row, Done closes).
 */
export function PickMany({
	label,
	summary,
	find,
	empty,
	rows,
	selected,
	onToggle,
}: {
	label: string;
	/** What the trigger says: "3 categories", or the prompt while none. */
	summary: string;
	find: string;
	empty: string;
	rows: Omit<PickRow, "selected">[];
	selected: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const tp = useTranslations("mobile.pickers");
	const [open, setOpen] = useState(false);
	return (
		<PickLabeled label={label}>
			<Chip
				accessibilityLabel={`${label}, ${summary}`}
				label={summary}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<PickerSheet
				clear={tp("clear")}
				empty={empty}
				find={find}
				groups={[
					{
						key: "all",
						heading: label,
						rows: rows.map((r) => ({ ...r, selected: selected.has(r.id) })),
					},
				]}
				multiple
				onClose={() => setOpen(false)}
				onSelect={onToggle}
				title={label}
				visible={open}
			/>
		</PickLabeled>
	);
}
