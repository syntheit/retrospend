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
import type { PeopleSort } from "./types";

const SORTS: PeopleSort[] = ["balance", "recent", "name"];

/** Sort people by balance, by the last thing shared, or by name. */
export function SortMenu({
	value,
	onChange,
}: {
	value: PeopleSort;
	onChange: (sort: PeopleSort) => void;
}) {
	const t = useTranslations("peoplePage.sort");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterChip value>{t("button", { sort: t(value) })}</FilterChip>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
				{SORTS.map((s) => (
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
