"use client";

import { useTranslations } from "next-intl";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import type { MonthData } from "./use-month";

/** The sentinel for "no group": a select needs a value for it. */
const NONE = "__none";

/** Pick the group an envelope sits in, or none. The groups are the month's own. */
export function GroupSelect({
	label,
	value,
	onChange,
	groups,
}: {
	label: string;
	value: string | null;
	onChange: (id: string | null) => void;
	groups: MonthData["groups"];
}) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	return (
		<Select
			kit
			onValueChange={(v) => onChange(v === NONE ? null : v)}
			value={value ?? NONE}
		>
			<SelectTrigger aria-label={label} className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{groups
					.filter((g) => g.id !== null)
					.map((g) => (
						<SelectItem key={g.id} value={g.id as string}>
							{g.name}
						</SelectItem>
					))}
				<SelectItem value={NONE}>{t("noGroup")}</SelectItem>
			</SelectContent>
		</Select>
	);
}
