"use client";

import { useTranslations } from "next-intl";
import { DatePicker } from "~/components/pickers/date-picker";
import { Segmented } from "~/components/ui/segmented";
import { Field } from "~/features/entry/shared-ui";
import { dayKey } from "~/lib/time-zone";
import type { PayAnswer, PayFrequency } from "./use-setup";

const FREQUENCIES: PayFrequency[] = [
	"MONTHLY",
	"EVERY_TWO_WEEKS",
	"WEEKLY",
	"VARIES",
];

/**
 * "How do you get paid?" (the mockup's pay step): how often, and the next
 * pay when it has a date. Nothing is picked until the person answers, and
 * an unanswered step writes nothing; the plan can start from the next pay.
 */
export function SetupPayStep({
	value,
	onChange,
}: {
	value: PayAnswer;
	onChange: (value: PayAnswer) => void;
}) {
	const t = useTranslations("budgetSheets.setup.pay");
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-fg text-section">{t("title")}</h2>
				<p className="text-fg-2 text-small">{t("sub")}</p>
			</div>
			<Field label={t("frequency")}>
				<Segmented<PayFrequency>
					full
					label={t("frequency")}
					onChange={(frequency) => onChange({ ...value, frequency })}
					options={FREQUENCIES.map((f) => ({ value: f, label: t(f) }))}
					// Nothing is selected until it is answered: no segment matches "".
					value={(value.frequency ?? "") as PayFrequency}
				/>
			</Field>
			{value.frequency && value.frequency !== "VARIES" ? (
				<Field label={t("next")}>
					<DatePicker
						onChange={(next) => onChange({ ...value, next })}
						today={dayKey(new Date())}
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
