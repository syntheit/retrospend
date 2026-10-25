import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Segmented } from "@/ui/Segmented";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { assignBody } from "./bodies";
import { AmountField, Line, useAmountLocale } from "./parts";
import { changesAnything, previewRows } from "./preview";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { type FormProps, noSession, useApi, WriteFrame } from "./WriteFrame";

type Mode = "add" | "set";

/**
 * Assign money to one envelope: add to what it has been given, or set it to
 * an amount (zero takes it all back). The dry run shows the envelope's Left
 * and the pool before Assign is on; the toast undoes it.
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
	const api = useApi();
	const announce = useUndoToast("budget");
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

	const flow = useMoneyWrite({
		input,
		idempotencyKey: input?.batchId ?? null,
		preview: (body) => (api ? api.budget.previewAssign(body) : noSession()),
		write: (body, key) =>
			api
				? api.budget.assign(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out || minor === null) return;
		const amount = money({ minor, currency });
		announce({
			message:
				mode === "add"
					? t("toastAdd", { amount, name: envelope.name })
					: t("toastSet", { amount, name: envelope.name }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const ready =
		flow.status === "ready" &&
		flow.preview !== null &&
		changesAnything(previewRows(flow.preview));

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
			ready={ready}
			submitLabel={t("submit")}
		>
			<Line label={t("assignedNow")} value={money(envelope.assigned)} />
			<Line
				label={tb(`pool.${data.toAssign.poolName}`)}
				value={money(data.toAssign.amount)}
			/>
			<Segmented
				accessibilityLabel={t("mode")}
				onChange={setMode}
				options={[
					{ value: "add", label: t("add") },
					{ value: "set", label: t("set") },
				]}
				value={mode}
			/>
			<AmountField
				allowZero={mode === "set"}
				currency={currency}
				draft={draft}
				entered={entered}
				label={mode === "add" ? t("amountAdd") : t("amountSet")}
				onDraftChange={setDraft}
			/>
		</WriteFrame>
	);
}
