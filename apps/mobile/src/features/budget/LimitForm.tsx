import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { AmountField, Line, useAmountLocale } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import {
	type FormProps,
	noSession,
	useApi,
	WriteFrame,
} from "@/features/write/WriteFrame";
import { Segmented } from "@/ui/Segmented";
import { BudgetChanges } from "./BudgetChanges";
import { type LimitScope, limitBody } from "./bodies";

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
	const api = useApi();
	const announce = useUndoToast("budget");
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

	const flow = useMoneyWrite({
		input,
		idempotencyKey: input?.id ?? null,
		preview: (body) => (api ? api.budget.previewSetLimit(body) : noSession()),
		write: (body, key) =>
			api
				? api.budget.setLimit(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out || minor === null) return;
		announce({
			message: t("toast", {
				name: envelope.name,
				amount: money({ minor, currency }),
			}),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<WriteFrame
			busy={flow.committing}
			changes={
				<BudgetChanges
					data={data}
					preview={flow.preview}
					status={flow.status}
				/>
			}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={flow.status === "ready"}
			submitLabel={t("submit")}
		>
			<Line label={t("now")} value={current ? money(current) : t("noLimit")} />
			<Segmented
				accessibilityLabel={t("scope")}
				onChange={setScope}
				options={[
					{ value: "THIS_MONTH", label: t("thisMonth") },
					{ value: "FROM_NOW_ON", label: t("fromNowOn") },
				]}
				value={scope}
			/>
			<AmountField
				allowZero
				currency={currency}
				draft={draft}
				entered={entered}
				label={t("amount")}
				onDraftChange={setDraft}
			/>
		</WriteFrame>
	);
}
