import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { DateField } from "@/ui/DateField";
import { Segmented } from "@/ui/Segmented";
import { minorOf, readAmount } from "./amount";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList } from "./fields";
import {
	type BillRepeat,
	type TargetChoice,
	type TargetMode,
	targetBody,
} from "./moreBodies";
import { AmountField, Line, Note, useAmountLocale } from "./parts";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { type FormProps, noSession, useApi, WriteFrame } from "./WriteFrame";

const REPEATS: BillRepeat[] = ["MONTHLY", "QUARTERLY", "YEARLY", "ONCE"];

/**
 * An envelope's target: none, a monthly amount (refill it each month, or set
 * that much aside), a bill with a due date, or a savings goal. The dry run
 * shows the plan's new need; the toast undoes it.
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
		now?.kind === "MONTHLY" || now?.kind === "SAVINGS" || now?.kind === "BILL"
			? now.kind
			: "NONE",
	);
	const [mode, setMode] = useState<TargetMode>(
		now?.mode === "SET_ASIDE" ? "SET_ASIDE" : "REFILL",
	);
	const [repeat, setRepeat] = useState<BillRepeat>("MONTHLY");
	const [due, setDue] = useState("");
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const bodyKey = JSON.stringify({
		id: envelope.id,
		choice,
		mode,
		minor,
		due,
		repeat,
	});
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
		dueDate: due,
		repeat,
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
			{now?.kind === "BILL" ? <Note>{t("billNote")}</Note> : null}
			<Segmented
				accessibilityLabel={t("kind.label")}
				onChange={setChoice}
				options={[
					{ value: "NONE", label: t("kind.NONE") },
					{ value: "MONTHLY", label: t("kind.MONTHLY") },
					{ value: "BILL", label: t("kind.BILL") },
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
			{choice === "BILL" ? (
				<>
					<DateField label={t("due")} onChange={setDue} value={due} />
					<ChoiceList
						choices={REPEATS.map((r) => ({ id: r, label: t(`repeat.${r}`) }))}
						label={t("repeats")}
						onPress={(id) => setRepeat(id as BillRepeat)}
						selected={new Set([repeat])}
					/>
				</>
			) : null}
			{choice === "NONE" ? (
				<Note>{t("noneNote")}</Note>
			) : (
				<AmountField
					currency={currency}
					draft={draft}
					entered={entered}
					label={t(
						choice === "MONTHLY"
							? "monthly"
							: choice === "BILL"
								? "billAmount"
								: "goal",
					)}
					onDraftChange={setDraft}
				/>
			)}
		</WriteFrame>
	);
}
