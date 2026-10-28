import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { Segmented } from "@/ui/Segmented";
import { minorOf, readAmount } from "./amount";
import { type WelcomeChoice, welcomeBackBody } from "./closeBodies";
import { monthDate } from "./months";
import { AmountField, Note, useAmountLocale } from "./parts";
import type { BudgetMonth } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteSheet } from "./WriteSheet";

/**
 * Welcome back, no blame: after weeks away, three ways back. Catch up reads
 * the months that closed on their own; Set what I have records one
 * adjustment from the money you have (prefilled from your accounts); Start
 * fresh returns every envelope's money to Not planned yet in one batch. Each
 * is previewed by the server and undoable.
 */
export function WelcomeBackSheet({
	data,
	visible,
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.welcomeBack");
	const format = useFormatter();
	const locale = useAmountLocale();
	const [choice, setChoice] = useState<WelcomeChoice>("CATCH_UP");
	const [draft, setDraft] = useState("");
	const read = useSheetRead(visible, (client) =>
		client.budget.welcomeBackState(),
	);
	const wb = read.status === "ready" ? read.data : null;
	const currency = wb?.bank.holds.currency ?? data.book.currency;
	const minor = minorOf(readAmount(draft, locale, currency), true);

	// Each opening starts at Catch up with the bank side as the prefill.
	useEffect(() => {
		if (!visible) return;
		setChoice("CATCH_UP");
		setDraft("");
	}, [visible]);
	useEffect(() => {
		if (wb) setDraft(draftFromMinor(wb.bank.bank.minor, locale, currency));
	}, [wb, locale, currency]);

	const { idFor } = useWriteIds(
		visible ? JSON.stringify([choice, minor]) : null,
	);
	const body = wb
		? welcomeBackBody({
				choice,
				id: idFor("adjustment"),
				batchId: idFor("batch"),
				minor,
				currency,
			})
		: null;
	const key = choice === "START_FRESH" ? idFor("batch") : idFor("adjustment");
	const months = (wb?.months ?? [])
		.map((m) =>
			format.dateTime(monthDate(m.month), { month: "long", timeZone: "UTC" }),
		)
		.join(", ");
	return (
		<WriteSheet
			data={data}
			idempotencyKey={body ? key : null}
			input={body}
			message={t(`toast.${choice}`)}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.budget.previewWelcomeBack(b)}
			submitLabel={t(`go.${choice}`)}
			title={t("title")}
			visible={visible}
			write={(api, b, k) =>
				api.budget.welcomeBack(b, { context: { idempotencyKey: k } })
			}
		>
			<Note>
				{wb && wb.months.length > 0
					? t("lead", { months, count: wb.months.length })
					: t("leadNone")}
			</Note>
			<Segmented
				accessibilityLabel={t("choice")}
				onChange={setChoice}
				options={[
					{ value: "CATCH_UP", label: t("catchUp") },
					{ value: "SET_HAVE_NOW", label: t("haveNow") },
					{ value: "START_FRESH", label: t("startFresh") },
				]}
				value={choice}
			/>
			<Note>{t(`about.${choice}`)}</Note>
			{choice === "SET_HAVE_NOW" ? (
				<AmountField
					allowZero
					currency={currency}
					draft={draft}
					entered={readAmount(draft, locale, currency)}
					label={t("haveLabel")}
					onDraftChange={setDraft}
				/>
			) : null}
			{choice === "CATCH_UP" ? <Note>{t("catchUpNothing")}</Note> : null}
		</WriteSheet>
	);
}
