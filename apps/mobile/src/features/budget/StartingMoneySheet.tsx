import type { Money } from "@retrospend/domain/money-minor";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "./amount";
import { startingMoneyBody } from "./closeBodies";
import { AmountField, Line, Note, useAmountLocale } from "./parts";
import type { BudgetMonth } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { WriteSheet } from "./WriteSheet";

/** What the dry run of the starting money says beyond the figures that move. */
interface StartingResult {
	booked: Money;
	alreadySpent: Money;
	since: string;
}

/**
 * Starting money: how much you have right now. The server compares it with
 * what the budget held: money in is added for what you have plus what was
 * already spent since the start, or an adjustment takes out what the budget
 * held beyond what you have. The dry run says which, in the server's own
 * figures, before anything is written; the toast takes it back.
 */
export function StartingMoneySheet({
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
	const t = useTranslations("mobile.budget.startingMoney");
	const money = useMoneyText();
	const format = useFormatter();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const [draft, setDraft] = useState("");
	const minor = minorOf(readAmount(draft, locale, currency), true);
	const { idFor } = useWriteIds(visible ? String(minor) : null);

	useEffect(() => {
		if (visible) setDraft("");
	}, [visible]);

	const body = startingMoneyBody({ id: idFor("start"), minor, currency });
	return (
		<WriteSheet
			after={(preview) => {
				const r = (preview?.detail as { result?: StartingResult } | undefined)
					?.result;
				if (!r?.booked || !r.alreadySpent) return null;
				return (
					<>
						{r.booked.minor > 0 ? (
							<Line label={t("moneyIn")} value={money(r.booked)} />
						) : null}
						{r.booked.minor < 0 ? (
							<Line label={t("adjustment")} value={money(r.booked)} />
						) : null}
						{r.alreadySpent.minor > 0 ? (
							<Note>
								{t("includes", {
									amount: money(r.alreadySpent),
									date: format.dateTime(new Date(`${r.since}T00:00:00Z`), {
										dateStyle: "medium",
										timeZone: "UTC",
									}),
								})}
							</Note>
						) : null}
						{r.booked.minor < 0 ? (
							<Note>
								{t("shortfall", { amount: money(r.booked, { sign: "never" }) })}
							</Note>
						) : null}
						{r.booked.minor === 0 ? <Note>{t("nothing")}</Note> : null}
					</>
				);
			}}
			data={data}
			idempotencyKey={body?.id ?? null}
			input={body}
			message={t("toast")}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.budget.previewConfirmStartingMoney(b)}
			submitLabel={t("save")}
			title={t("title")}
			visible={visible}
			write={(api, b, key) =>
				api.budget.confirmStartingMoney(b, {
					context: { idempotencyKey: key },
				})
			}
		>
			<Note>{t("lead")}</Note>
			<AmountField
				allowZero
				currency={currency}
				draft={draft}
				entered={readAmount(draft, locale, currency)}
				label={t("have")}
				onDraftChange={setDraft}
			/>
		</WriteSheet>
	);
}
