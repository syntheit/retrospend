"use client";

import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { useCategoryName } from "~/hooks/use-category-name";
import { getCategoryIcon } from "~/lib/category-icons";
import { rankedFilter, splitRecent } from "./match";
import { PickerGroup, PickerItem, PickerList } from "./picker-list";

export type PickerCategory = {
	id: string;
	name: string;
	/** A CATEGORY_ICON_REGISTRY name; falls back to the name's usual icon. */
	icon?: string | null;
	/** Category color token number, 1 to 21 (--category-n). */
	tone: number;
};

type Shared = {
	/** In the one category order (the ledger order); the picker keeps it. */
	categories: readonly PickerCategory[];
	/** Most used first; they lead the list above all categories. */
	recentIds?: readonly string[];
};

export type CategoryPickerProps = Shared &
	(
		| {
				multiple?: false;
				value: string | null;
				onChange: (id: string) => void;
		  }
		| {
				/** A filter: a pick toggles and the list stays open. */
				multiple: true;
				value: readonly string[];
				onChange: (ids: string[]) => void;
		  }
	);

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
 * CategoryPicker: the one category picker. A Find field that filters as you
 * type (Enter picks the top match, arrows move, Escape closes the popover or
 * sheet around it), most used first, then every category in one order, each
 * with its bare glyph in its color. `multiple` makes it a filter.
 * Put it in a popover or a sheet; it is the content, not the trigger.
 */
export function CategoryPicker(props: CategoryPickerProps) {
	const t = useTranslations("pickers.category");
	const { displayName } = useCategoryName();
	const { recent, rest } = splitRecent(props.categories, props.recentIds);
	const picked = (id: string) =>
		props.multiple ? props.value.includes(id) : props.value === id;
	const pick = (id: string) => {
		if (props.multiple)
			props.onChange(
				props.value.includes(id)
					? props.value.filter((v) => v !== id)
					: [...props.value, id],
			);
		else props.onChange(id);
	};
	const item = (c: PickerCategory) => {
		const name = displayName(c.name);
		return (
			<PickerItem
				key={c.id}
				keywords={[name]}
				lead={<CategoryGlyph category={c} />}
				onSelect={() => pick(c.id)}
				selected={picked(c.id)}
				selectedLabel={t("selected")}
				value={c.id}
			>
				{name}
			</PickerItem>
		);
	};
	return (
		<PickerList
			empty={t("empty")}
			filter={rankedFilter}
			footer={
				props.multiple && props.value.length > 0 ? (
					<Button
						className="self-end"
						kind="ghost"
						onClick={() => props.onChange([])}
						size="sm"
					>
						{t("clear")}
					</Button>
				) : null
			}
			label={t("label")}
			placeholder={t("find")}
		>
			{recent.length > 0 ? (
				<PickerGroup heading={t("recent")}>{recent.map(item)}</PickerGroup>
			) : null}
			<PickerGroup heading={recent.length > 0 ? t("all") : t("label")}>
				{rest.map(item)}
			</PickerGroup>
		</PickerList>
	);
}
