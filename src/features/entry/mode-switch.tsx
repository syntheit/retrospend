"use client";

import { ArrowDownLeft, ArrowRightLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Segmented } from "~/components/ui/segmented";
import type { EntryCarry, EntryMode } from "./types";

/**
 * The composer's mode switch (Expense, Income, Transfer), in the sheet's
 * header slot. An edit passes none: a saved entry keeps its type.
 */
export function ModeSwitch({
	mode,
	carry,
	onMode,
}: {
	mode: EntryMode;
	/** What carries over to the other modes. */
	carry: EntryCarry;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	const t = useTranslations("entry.mode");
	return (
		<Segmented
			className="max-md:flex"
			label={t("label")}
			onChange={(m) => onMode(m, carry)}
			options={[
				{
					value: "expense",
					label: t("expense"),
					icon: <Plus aria-hidden="true" />,
				},
				{
					value: "income",
					label: t("income"),
					icon: <ArrowDownLeft aria-hidden="true" />,
				},
				{
					value: "transfer",
					label: t("transfer"),
					icon: <ArrowRightLeft aria-hidden="true" />,
				},
			]}
			value={mode}
		/>
	);
}
