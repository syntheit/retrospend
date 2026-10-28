import { useCallback } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { monthDate } from "./months";
import { joinNames, type VerdictLine, type VerdictValue } from "./verdict";

/**
 * Turns a verdict line (a message key and the verdict's own values) into
 * text: money through the one money formatter, months and dates in the
 * device's language. `names` maps envelope ids to names for "Restaurants
 * went over by".
 */
export function useVerdictText(names: ReadonlyMap<string, string>) {
	const t = useTranslations("mobile.budget.verdict");
	const format = useFormatter();
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();

	const value = useCallback(
		(v: VerdictValue): string | number => {
			switch (v.kind) {
				case "money":
					return money(v.money, {
						...(v.unsigned ? { sign: "never" as const } : {}),
						...(v.whole ? { cents: false } : {}),
					});
				case "month":
					return format.dateTime(monthDate(v.key), {
						month: "long",
						timeZone: "UTC",
					});
				case "date":
					return v.iso
						? format.dateTime(new Date(`${v.iso}T12:00:00Z`), {
								weekday: "long",
								month: "short",
								day: "numeric",
								timeZone: "UTC",
							})
						: "";
				case "names":
					return joinNames(
						v.ids.map((id) => names.get(id) ?? "").filter((n) => n !== ""),
						(head, last) => tb("listAnd", { head, last }),
					);
				case "number":
					return v.value;
			}
		},
		[format, money, names, tb],
	);

	return useCallback(
		(line: VerdictLine): string =>
			t(
				line.key as "allAssigned",
				Object.fromEntries(
					Object.entries(line.values).map(([k, v]) => [k, value(v)]),
				),
			),
		[t, value],
	);
}
