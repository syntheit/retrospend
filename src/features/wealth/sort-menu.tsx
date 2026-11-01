"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { FilterChip } from "~/components/ui/chip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { WEALTH_SORTS, type WealthSort } from "./sort";

/** Sort the accounts: your own order, value, name, type or when they changed. */
export function SortMenu({
	value,
	onChange,
}: {
	value: WealthSort;
	onChange: (sort: WealthSort) => void;
}) {
	const t = useTranslations("wealthPage.sort");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterChip value>{t("button", { sort: t(value) })}</FilterChip>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
				{WEALTH_SORTS.map((s) => (
					<DropdownMenuItem key={s} onSelect={() => onChange(s)}>
						<Check
							aria-hidden="true"
							className={s === value ? undefined : "invisible"}
						/>
						{t(s)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
