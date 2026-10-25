"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { DatePicker } from "~/components/pickers/date-picker";
import { Row, RowList } from "~/components/rows/row";
import { Field } from "~/features/entry/shared-ui";
import { dayKey } from "@retrospend/domain/time-zone";
import type { PayAnswer, PayFrequency } from "./use-setup";

const FREQUENCIES: PayFrequency[] = [
	"MONTHLY",
	"EVERY_TWO_WEEKS",
	"WEEKLY",
	"VARIES",
];

/**
 * "How do you get paid?" (the mockup's pay step): how often, and the next
 * pay when the cycle has a date. Nothing is picked until the person
 * answers, and an unanswered step writes nothing. A dated cycle needs the
 * next pay picked from the calendar, today or later. The answers are a list,
 * like the style question, so the longest one never has to fit a row.
 */
export function SetupPayStep({
	value,
	onChange,
}: {
	value: PayAnswer;
	onChange: (value: PayAnswer) => void;
}) {
	const t = useTranslations("budgetSheets.setup.pay");
	const ts = useTranslations("budgetSheets.setup");
	const today = dayKey(new Date());
	const dated = value.frequency && value.frequency !== "VARIES";
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-fg text-section">{t("title")}</h2>
				<p className="text-fg-2 text-small">{t("sub")}</p>
			</div>
			<RowList label={t("frequency")} variant="flat">
				{FREQUENCIES.map((f) => (
					<Row
						end={
							f === value.frequency ? (
								<Check aria-hidden="true" className="text-brand size-4" />
							) : null
						}
						key={f}
						open={{
							onOpen: () => onChange({ ...value, frequency: f }),
							label: ts("pickStyle", { name: t(f) }),
						}}
						title={t(f)}
					/>
				))}
			</RowList>
			{dated ? (
				<Field
					error={value.next && value.next < today ? t("past") : null}
					label={t("next")}
				>
					<DatePicker
						calendarOnly
						onChange={(next) => onChange({ ...value, next })}
						today={today}
						value={value.next}
					/>
				</Field>
			) : null}
			{value.frequency ? (
				<p className="text-fg-3 text-small">
					{value.frequency === "VARIES" ? t("variesHint") : t("hint")}
				</p>
			) : null}
		</div>
	);
}
