"use client";

import { useTranslations } from "next-intl";

import { getCategoryIcon } from "~/lib/category-icons";
import { splitRecent } from "./match";
import { PickerGroup, PickerItem, PickerList } from "./picker-list";

export type PickerCategory = {
	id: string;
	name: string;
	/** A CATEGORY_ICON_REGISTRY name; falls back to the name's usual icon. */
	icon?: string | null;
	/** Category color token number, 1 to 21 (--category-n). */
	tone: number;
};

export type CategoryPickerProps = {
	/** In the one category order (the ledger order); the picker keeps it. */
	categories: readonly PickerCategory[];
	recentIds?: readonly string[];
	value: string | null;
	onChange: (id: string) => void;
};

/** The bare glyph in its category color: identity without a tile (R25 amended). */
export function CategoryGlyph({ category }: { category: PickerCategory }) {
	const Icon = getCategoryIcon(category.name, category.icon);
	return (
		<Icon
			aria-hidden="true"
			className="size-4"
			style={{ color: `var(--category-${category.tone})` }}
		/>
	);
}

/**
 * CategoryPicker: the one category picker. Recents first, then every
 * category in one order, a Find field, the bare glyph in its color.
 * Put it in a popover or a sheet; it is the content, not the trigger.
 */
export function CategoryPicker({
	categories,
	recentIds,
	value,
	onChange,
}: CategoryPickerProps) {
	const t = useTranslations("pickers.category");
	const { recent, rest } = splitRecent(categories, recentIds);
	const item = (c: PickerCategory) => (
		<PickerItem
			key={c.id}
			keywords={[c.name]}
			lead={<CategoryGlyph category={c} />}
			onSelect={() => onChange(c.id)}
			selected={c.id === value}
			selectedLabel={t("selected")}
			value={c.id}
		>
			{c.name}
		</PickerItem>
	);
	return (
		<PickerList empty={t("empty")} label={t("label")} placeholder={t("find")}>
			{recent.length > 0 ? (
				<PickerGroup heading={t("recent")}>{recent.map(item)}</PickerGroup>
			) : null}
			<PickerGroup heading={recent.length > 0 ? t("all") : t("label")}>
				{rest.map(item)}
			</PickerGroup>
		</PickerList>
	);
}
