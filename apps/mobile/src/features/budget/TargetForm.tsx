import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Segmented } from "@/ui/Segmented";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { type TargetChoice, type TargetMode, targetBody } from "./moreBodies";
import { AmountField, Line, Note, useAmountLocale } from "./parts";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { type FormProps, noSession, useApi, WriteFrame } from "./WriteFrame";

/**
 * An envelope's target: none, a monthly amount (refill it each month, or set
 * that much aside), or a savings goal. Bills with a due date are on the web.
 * The dry run shows the plan's new need; the toast undoes it.
 */
export function TargetForm({ data, envelope, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.target");
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const now = envelope.target;
	const [choice, setChoice] = useState<TargetChoice>(
		now?.kind === "MONTHLY" || now?.kind === "SAVINGS" ? now.kind : "NONE",
	);
	const [mode, setMode] = useState<TargetMode>(
		now?.mode === "SET_ASIDE" ? "SET_ASIDE" : "REFILL",
	);
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const bodyKey = JSON.stringify({ id: envelope.id, choice, mode, minor });
	const { idFor } = useWriteIds(bodyKey);
	// Nothing to say yet: no target now and none picked.
	const idle = choice === "NONE" && now === null;
	const built = targetBody({
		id: idFor("target"),
		envelopeId: envelope.id,
		choice,
		mode,
		minor,
		currency,
	});
	const body = idle ? null : built;
	const flow = useMoneyWrite({
		input: body,
		idempotencyKey: body?.id ?? null,
		preview: (b) => (api ? api.budget.previewSetTarget(b) : noSession()),
		write: (b, key) =>
			api
				? api.budget.setTarget(b, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { name: envelope.name }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const bill = now?.kind === "BILL";
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
			<Line
				label={t("now")}
				value={
					now?.amount
						? `${t(`kind.${now.kind}`)}, ${money(now.amount)}`
						: t("noTarget")
				}
			/>
			{bill ? <Note>{t("billNote")}</Note> : null}
			<Segmented
				accessibilityLabel={t("kind.label")}
				onChange={setChoice}
				options={[
					{ value: "NONE", label: t("kind.NONE") },
					{ value: "MONTHLY", label: t("kind.MONTHLY") },
					{ value: "SAVINGS", label: t("kind.SAVINGS") },
				]}
				value={choice}
			/>
			{choice === "MONTHLY" ? (
				<Segmented
					accessibilityLabel={t("mode.label")}
					onChange={setMode}
					options={[
						{ value: "REFILL", label: t("mode.REFILL") },
						{ value: "SET_ASIDE", label: t("mode.SET_ASIDE") },
					]}
					value={mode}
				/>
			) : null}
			{choice === "NONE" ? null : (
				<AmountField
					currency={currency}
					draft={draft}
					entered={entered}
					label={t(choice === "MONTHLY" ? "monthly" : "goal")}
					onDraftChange={setDraft}
				/>
			)}
		</WriteFrame>
	);
}
