import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "./Glyph";
import { PickerSheet } from "./PickerSheet";
import type { PickGroup } from "./pickGroups";

/** What the picker needs of a category: its name, glyph and color slot. */
export interface PickableCategory {
	id: string;
	name: string;
	icon: string | null;
	tone: number;
}

/** A place that stands in the list without being a category (Not planned yet). */
export interface PickExtra {
	id: string;
	name: string;
	/** Already worded: what the place holds. */
	detail?: string;
}

/**
 * Every category in one full-height, searchable sheet: the ones you use most
 * first (`top`, the pills already on screen), then all the rest, each with its
 * bare glyph in the category color (a tinted tile belongs in list rows only).
 * It is the one category picker: the composer opens it from its More pill,
 * Activity and the bulk Categorize open it, and the budget forms open it for
 * their envelopes (an envelope is a category with a budget; `extras` leads
 * with places such as Not planned yet, `detailOf` says what each has left, and
 * `none` adds a first row that clears the choice). Any screen that picks a
 * category can open it the same way by owning `visible`. A pick closes it.
 */
export function CategoryPickerSheet<T extends PickableCategory>({
	visible,
	onClose,
	categories,
	top,
	value,
	onChange,
	extras,
	detailOf,
	none,
	copy,
}: {
	visible: boolean;
	onClose: () => void;
	categories: T[];
	/** Shown first, under the Recent heading. */
	top?: T[];
	value: string | null;
	onChange: (id: string) => void;
	/** Places ahead of the categories, with no glyph. */
	extras?: PickExtra[];
	/** The line under each category's name. */
	detailOf?: (category: T) => string | undefined;
	/** A first row that clears the choice; `onPick` runs when it is chosen. */
	none?: { label: string; onPick: () => void };
	/** Other words for the title, the search hint and the empty list (envelopes). */
	copy?: { title: string; find: string; empty: string };
}) {
	const t = useTranslations("mobile.pickers");
	const { color, size } = useTheme();
	const NONE = "";
	const groups = useMemo<PickGroup[]>(() => {
		const row = (c: T) => ({
			id: c.id,
			label: c.name,
			detail: detailOf?.(c),
			lead: (
				<CategoryGlyph
					category={c}
					color={categoryColor(color, c.tone)}
					size={size.icon.phone}
				/>
			),
			selected: c.id === value,
		});
		const first = new Set((top ?? []).map((c) => c.id));
		const lead = [
			...(none
				? [{ id: NONE, label: none.label, lead: null, selected: value === null }]
				: []),
			...(extras ?? []).map((x) => ({
				id: x.id,
				label: x.name,
				detail: x.detail,
				lead: null,
				selected: x.id === value,
			})),
		];
		return [
			...(lead.length > 0
				? [{ key: "places", heading: "", rows: lead }]
				: []),
			...(top?.length
				? [{ key: "recent", heading: t("category.recent"), rows: top.map(row) }]
				: []),
			{
				key: "all",
				heading: t("category.all"),
				rows: categories.filter((c) => !first.has(c.id)).map(row),
			},
		];
	}, [
		categories,
		top,
		value,
		color,
		size.icon.phone,
		t,
		extras,
		detailOf,
		none,
	]);

	return (
		<PickerSheet
			clear={t("clear")}
			empty={copy?.empty ?? t("category.empty")}
			find={copy?.find ?? t("category.find")}
			groups={groups}
			onClose={onClose}
			onSelect={(id) => (id === NONE && none ? none.onPick() : onChange(id))}
			title={copy?.title ?? t("category.title")}
			visible={visible}
		/>
	);
}
