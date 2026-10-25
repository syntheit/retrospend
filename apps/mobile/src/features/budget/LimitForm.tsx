import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Segmented } from "@/ui/Segmented";
import { minorOf, readAmount } from "./amount";
import { type LimitScope, limitBody } from "./bodies";
import { BudgetChanges } from "./BudgetChanges";
import { AmountField, Line, useAmountLocale } from "./parts";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import {
	type FormProps,
	noSession,
	useApi,
	WriteFrame,
} from "./WriteFrame";

/**
 * Limits books give each envelope a limit instead of assigned money. Set the
 * new limit for this month or from now on; the dry run shows what it does to
 * Left in your limits, and the toast undoes it.
 */
export function LimitForm({ data, envelope, month, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.limit");
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
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
				<BudgetChanges data={data} preview={flow.preview} status={flow.status} />
			}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={flow.status === "ready"}
			submitLabel={t("submit")}
		>
			<Line label={t("now")} value={money(envelope.assigned)} />
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
