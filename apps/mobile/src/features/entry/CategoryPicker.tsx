import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickGroup } from "@/ui/pickGroups";
import type { EntryCategory } from "./types";

/**
 * Every category in one sheet: Recent first, then all, each with its bare
 * glyph in the category color (a tinted tile belongs in list rows only), and
 * a search field. The trigger chip that opens it is the composer's "More".
 */
export function CategoryPicker({
	categories,
	recent,
	value,
	onChange,
}: {
	categories: EntryCategory[];
	/** The category chips already on screen, shown first. */
	recent: EntryCategory[];
	value: string | null;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const tc = useTranslations("mobile.composer");
	const { color, size } = useTheme();
	const [open, setOpen] = useState(false);
	const groups = useMemo<PickGroup[]>(() => {
		const row = (c: EntryCategory) => ({
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
		const first = new Set(recent.map((c) => c.id));
		return [
			{ key: "recent", heading: t("category.recent"), rows: recent.map(row) },
			{
				key: "all",
				heading: t("category.all"),
				rows: categories.filter((c) => !first.has(c.id)).map(row),
			},
		];
	}, [categories, recent, value, color, size.icon.phone, t]);

	return (
		<>
			<Chip
				accessibilityLabel={tc("categoriesAll")}
				label={tc("categoriesMore")}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<PickerSheet
				clear={t("clear")}
				empty={t("category.empty")}
				find={t("category.find")}
				groups={groups}
				onClose={() => setOpen(false)}
				onSelect={onChange}
				title={t("category.title")}
				visible={open}
			/>
		</>
	);
}
