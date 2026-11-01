import { useState } from "react";
import { useTranslations } from "use-intl";
import { CategoryPickerSheet } from "@/ui/CategoryPickerSheet";
import { Chip } from "@/ui/Chip";
import type { EntryCategory } from "./types";

/**
 * The More pill after the top categories: it opens the full-height, searchable
 * list of every category (`CategoryPickerSheet`). The pills on screen come
 * first in that list under Recent.
 */
export function CategoryPicker({
	categories,
	recent,
	value,
	onChange,
}: {
	categories: EntryCategory[];
	/** The category pills already on screen, shown first. */
	recent: EntryCategory[];
	value: string | null;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("mobile.composer");
	const [open, setOpen] = useState(false);
	return (
		<>
			<Chip
				label={t("categoriesMore")}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<CategoryPickerSheet
				categories={categories}
				onChange={onChange}
				onClose={() => setOpen(false)}
				top={recent}
				value={value}
				visible={open}
			/>
		</>
	);
}
