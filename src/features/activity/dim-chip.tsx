"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import {
	PickerGroup,
	PickerItem,
	PickerList,
} from "~/components/pickers/picker-list";
import { PickerPopover } from "~/components/pickers/picker-popover";
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
}: {
	/** The dimension's name: the chip's text when nothing is picked. */
	label: string;
	items: DimItem[];
	value: string[];
	onChange: (value: string[]) => void;
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
			<PickerList empty={t("noMatch")} label={label} placeholder={t("find")}>
				{value.length > 0 && (
					<PickerGroup heading={t("picked")}>
						<PickerItem
							keywords={[t("clear")]}
							lead={null}
							onSelect={() => onChange([])}
							selected={false}
							selectedLabel=""
							value="__clear"
						>
							{t("clear")}
						</PickerItem>
					</PickerGroup>
				)}
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
		</PickerPopover>
	);
}
