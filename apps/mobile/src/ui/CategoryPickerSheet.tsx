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

/**
 * Every category in one full-height, searchable sheet: the ones you use most
 * first (`top`, the pills already on screen), then all the rest, each with its
 * bare glyph in the category color (a tinted tile belongs in list rows only).
 * It is the one category picker: the composer opens it from its More pill, and
 * any screen that picks a category can open it the same way by owning
 * `visible`. A pick closes it.
 */
export function CategoryPickerSheet<T extends PickableCategory>({
	visible,
	onClose,
	categories,
	top,
	value,
	onChange,
}: {
	visible: boolean;
	onClose: () => void;
	categories: T[];
	/** Shown first, under the Recent heading. */
	top?: T[];
	value: string | null;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const { color, size } = useTheme();
	const groups = useMemo<PickGroup[]>(() => {
		const row = (c: T) => ({
			id: c.id,
			label: c.name,
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
		return [
			...(top?.length
				? [{ key: "recent", heading: t("category.recent"), rows: top.map(row) }]
				: []),
			{
				key: "all",
				heading: t("category.all"),
				rows: categories.filter((c) => !first.has(c.id)).map(row),
			},
		];
	}, [categories, top, value, color, size.icon.phone, t]);

	return (
		<PickerSheet
			clear={t("clear")}
			empty={t("category.empty")}
			find={t("category.find")}
			full
			groups={groups}
			onClose={onClose}
			onSelect={onChange}
			title={t("category.title")}
			visible={visible}
		/>
	);
}
