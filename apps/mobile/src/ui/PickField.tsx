import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Chip } from "./Chip";
import { ListRow, NavEnd } from "./List";
import { PickerSheet } from "./PickerSheet";
import type { PickRow } from "./pickGroups";
import { Text } from "./Text";

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
	readOnly,
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
	/** Shows the pick but cannot change it (a saved expense keeps its project): no chevron, no sheet. */
	readOnly?: boolean;
	onChange: (id: string | null) => void;
}) {
	const t = useTranslations("mobile.pickers");
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
						<NavEnd chevron={!readOnly} lead={shown.lead} value={shown.text} />
					}
					onPress={readOnly ? undefined : () => setOpen(true)}
					title={
						<Text numberOfLines={1} weight="normal">
							{label}
						</Text>
					}
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
