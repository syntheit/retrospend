import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Line, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { FormProps } from "@/features/write/WriteFrame";
import { AmountField } from "@/ui/AmountField";
import { Segmented } from "@/ui/Segmented";
import { assignBody } from "./bodies";
import { changesAnything } from "./preview";
import { WriteForm } from "./WriteSheet";

type Mode = "add" | "set";

/**
 * Assign money to one envelope: add to what it has been given, or set it to
 * an amount (zero takes it all back). The amount comes first. The dry run
 * shows the envelope's Left and the pool before Assign is on, and Assign
 * stays off when it would change nothing; the toast undoes it.
 */
export function AssignForm({
	data,
	envelope,
	month,
	onDone,
	onClose,
}: FormProps) {
	const t = useTranslations("mobile.budget.assign");
	const tb = useTranslations("mobile.budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const [mode, setMode] = useState<Mode>("add");
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered, mode === "set");
	const bodyKey =
		minor === null
			? null
			: JSON.stringify({ mode, minor, month, id: envelope.id });
	const { idFor } = useWriteIds(bodyKey);
	const input =
		minor === null
			? null
			: assignBody({
					batchId: idFor("batch"),
					itemId: idFor("item"),
					month,
					envelopeId: envelope.id,
					mode,
					minor,
					currency,
				});

	return (
		<WriteForm
			canSave={changesAnything}
			data={data}
			idempotencyKey={input?.batchId ?? null}
			input={input}
			message={() => {
				const amount = money({ minor: minor ?? 0, currency });
				return mode === "add"
					? t("toastAdd", { amount, name: envelope.name })
					: t("toastSet", { amount, name: envelope.name });
			}}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.budget.previewAssign(body)}
			submitLabel={t("submit")}
			write={(api, body, key) =>
				api.budget.assign(body, { context: { idempotencyKey: key } })
			}
		>
			<AmountField
				allowZero={mode === "set"}
				currency={currency}
				draft={draft}
				entered={entered}
				label={mode === "add" ? t("amountAdd") : t("amountSet")}
				onDraftChange={setDraft}
			/>
			<Segmented
				accessibilityLabel={t("mode")}
				onChange={setMode}
				options={[
					{ value: "add", label: t("add") },
					{ value: "set", label: t("set") },
				]}
				stretch
				value={mode}
			/>
			<Line label={t("assignedNow")} value={money(envelope.assigned)} />
			<Line
				label={tb(`pool.${data.toAssign.poolName}`)}
				value={money(data.toAssign.amount)}
			/>
		</WriteForm>
	);
}
