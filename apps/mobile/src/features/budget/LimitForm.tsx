import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Line, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { FormProps } from "@/features/write/WriteFrame";
import { AmountField } from "@/ui/AmountField";
import { Segmented } from "@/ui/Segmented";
import { type LimitScope, limitBody } from "./bodies";
import { WriteForm } from "./WriteSheet";

/**
 * Limits books give each envelope a limit instead of assigned money. Set the
 * new limit for this month or from now on; the dry run shows what it does to
 * Left in your limits, and the toast undoes it.
 */
export function LimitForm({
	data,
	envelope,
	month,
	onDone,
	onClose,
}: FormProps) {
	const t = useTranslations("mobile.budget.limit");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	// The limit now is the envelope's monthly target (the web's own start).
	const current =
		envelope.target?.kind === "MONTHLY" ? envelope.target.amount : null;
	const [scope, setScope] = useState<LimitScope>("THIS_MONTH");
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	// A limit of zero is a real answer: spending is tracked, nothing is allowed.
	const minor = minorOf(entered, true);
	const bodyKey =
		minor === null
			? null
			: JSON.stringify({ scope, minor, id: envelope.id, month });
	const { idFor } = useWriteIds(bodyKey);
	const input =
		minor === null
			? null
			: limitBody({
					id: idFor("limit"),
					envelopeId: envelope.id,
					minor,
					currency,
					scope,
				});

	return (
		<WriteForm
			data={data}
			idempotencyKey={input?.id ?? null}
			input={input}
			message={() =>
				t("toast", {
					name: envelope.name,
					amount: money({ minor: minor ?? 0, currency }),
				})
			}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.budget.previewSetLimit(body)}
			submitLabel={t("submit")}
			write={(api, body, key) =>
				api.budget.setLimit(body, { context: { idempotencyKey: key } })
			}
		>
			<AmountField
				allowZero
				currency={currency}
				draft={draft}
				entered={entered}
				label={t("amount")}
				onDraftChange={setDraft}
			/>
			<Segmented
				accessibilityLabel={t("scope")}
				onChange={setScope}
				options={[
					{ value: "THIS_MONTH", label: t("thisMonth") },
					{ value: "FROM_NOW_ON", label: t("fromNowOn") },
				]}
				stretch
				value={scope}
			/>
			<Line label={t("now")} value={current ? money(current) : t("noLimit")} />
		</WriteForm>
	);
}
