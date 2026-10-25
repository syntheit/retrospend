"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Row, RowList, RowSub } from "~/components/rows/row";
import type { SetupStyle } from "./use-setup";

export type Choice = SetupStyle | "TRACK";

/** The five answers, then the three methods (the mockup's first question). */
const ANSWERS: Choice[] = [
	"TRACK",
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
];
const METHODS: Choice[] = ["FIFTY_THIRTY_TWENTY", "WEEKLY"];

/**
 * "How do you like to budget?": one question, five answers and the methods
 * under "Or follow a method". The picked answer shows a check; nothing is
 * written until the last step.
 */
export function SetupStyleStep({
	value,
	onChange,
}: {
	value: Choice;
	onChange: (choice: Choice) => void;
}) {
	const t = useTranslations("budgetSheets.setup");
	const ts = useTranslations("budgetSheets.style");
	const list = (label: string, choices: Choice[]) => (
		<RowList label={label} variant="flat">
			{choices.map((c) => (
				<Row
					end={
						c === value ? (
							<Check aria-hidden="true" className="text-brand size-4" />
						) : null
					}
					key={c}
					open={{
						onOpen: () => onChange(c),
						label: t("pickStyle", { name: ts(`${c}.name`) }),
					}}
					sub={
						<RowSub
							parts={[ts(`${c}.sub`), c === "FLEX" ? t("recommended") : null]}
						/>
					}
					title={ts(`${c}.name`)}
				/>
			))}
		</RowList>
	);
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-fg text-section">{t("styleTitle")}</h2>
				<p className="text-fg-2 text-small">{t("styleSub")}</p>
			</div>
			{list(t("styleTitle"), ANSWERS)}
			<h3 className="text-fg text-small font-semibold">{t("methods")}</h3>
			{list(t("methods"), METHODS)}
		</div>
	);
}
