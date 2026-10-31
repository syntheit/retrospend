"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import {
	CategoryPicker,
	type PickerCategory,
} from "~/components/pickers/category-picker";
import {
	PickerGroup,
	PickerItem,
	PickerList,
} from "~/components/pickers/picker-list";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { FilterChip } from "~/components/ui/chip";
import { toggled } from "./filters";

export type DimItem = { id: string; label: string; lead?: ReactNode };

/**
 * One filter dimension as a chip (RC4): "Category", or "Groceries +1" once
 * something is picked. It opens a multi-select list with identity in the
 * lead slot (R25); a pick toggles and the list stays open.
 */
export function DimChip({
	label,
	items,
	value,
	onChange,
	categories,
	recentIds,
}: {
	/** The dimension's name: the chip's text when nothing is picked. */
	label: string;
	items: DimItem[];
	value: string[];
	onChange: (value: string[]) => void;
	/** The Category chip opens the one CategoryPicker (most used first) instead of the plain list. */
	categories?: readonly PickerCategory[];
	recentIds?: readonly string[];
}) {
	const t = useTranslations("activity.filters");
	const [open, setOpen] = useState(false);
	const first = items.find((i) => i.id === value[0])?.label ?? value[0];
	const text = value.length
		? value.length > 1
			? t("more", { name: first ?? "", count: value.length - 1 })
			: (first ?? "")
		: label;
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={label}
			trigger={
				<FilterChip aria-haspopup="dialog" selected={value.length > 0}>
					{text}
					<ChevronDown aria-hidden="true" />
				</FilterChip>
			}
		>
			{categories ? (
				<CategoryPicker
					categories={categories}
					multiple
					onChange={onChange}
					recentIds={recentIds}
					value={value}
				/>
			) : (
				<PickerList
					empty={t("noMatch")}
					footer={
						value.length > 0 ? (
							<Button
								className="self-end"
								kind="ghost"
								onClick={() => onChange([])}
								size="sm"
							>
								{t("clear")}
							</Button>
						) : null
					}
					label={label}
					placeholder={t("find")}
				>
					<PickerGroup heading={label}>
						{items.map((item) => (
							<PickerItem
								key={item.id}
								keywords={[item.label]}
								lead={item.lead}
								onSelect={() => onChange(toggled(value, item.id))}
								selected={value.includes(item.id)}
								selectedLabel={t("selected")}
								value={item.id}
							>
								{item.label}
							</PickerItem>
						))}
					</PickerGroup>
				</PickerList>
			)}
		</PickerPopover>
	);
}
