import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Line, Note, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { FormProps } from "@/features/write/WriteFrame";
import { AmountField } from "@/ui/AmountField";
import { DateField } from "@/ui/DateField";
import { Segmented } from "@/ui/Segmented";
import { ChoiceList } from "./fields";
import {
	type BillRepeat,
	type TargetChoice,
	type TargetMode,
	targetBody,
} from "./moreBodies";
import { WriteForm } from "./WriteSheet";

const REPEATS: BillRepeat[] = ["MONTHLY", "QUARTERLY", "YEARLY", "ONCE"];

/**
 * An envelope's target: none, a monthly amount (refill it each month, or set
 * that much aside), a bill with a due date, or a savings goal. The dry run
 * shows the plan's new need; the toast undoes it.
 */
export function TargetForm({ data, envelope, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.target");
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
	return (
		<WriteForm
			data={data}
			idempotencyKey={body?.id ?? null}
			input={body}
			message={() => t("toast", { name: envelope.name })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.budget.previewSetTarget(b)}
			submitLabel={t("submit")}
			write={(api, b, key) =>
				api.budget.setTarget(b, { context: { idempotencyKey: key } })
			}
		>
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
			{choice === "NONE" ? null : (
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
			{choice === "NONE" ? <Note>{t("noneNote")}</Note> : null}
			<Line
				label={t("now")}
				value={
					now?.amount
						? `${t(`kind.${now.kind}`)}, ${money(now.amount)}`
						: t("noTarget")
				}
			/>
			{now?.kind === "BILL" ? <Note>{t("billNote")}</Note> : null}
		</WriteForm>
	);
}
