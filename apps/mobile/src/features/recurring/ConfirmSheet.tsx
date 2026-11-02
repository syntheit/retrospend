import { draftFromMinor } from "@retrospend/domain/parse";
import { useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useResetOnOpen } from "@/features/write/useResetOnOpen";
import { WriteSheet } from "@/features/write/WriteForm";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { Button } from "@/ui/Button";
import { DateField } from "@/ui/DateField";
import type { RecurringItem } from "./source";

/** A calendar day ("2026-11-01") as "Nov 1". */
export function useDayText() {
	const format = useFormatter();
	return (day: string) =>
		format.dateTime(new Date(`${day}T12:00:00Z`), {
			month: "short",
			day: "numeric",
			timeZone: "UTC",
		});
}

/**
 * Confirm a due recurring expense or income: the server books the entry and
 * moves the template on from its due date. Paid on says which day it books on
 * (one date field that starts on the due date, with Today and Yesterday as
 * shortcuts); the rate follows that day. A varying amount (amountMode ask)
 * starts at the usual amount and is edited here; a fixed one is shown, since the server keeps it fixed.
 * Skip this time hands over to the skip sheet. Auto-pay is not here: it is a
 * separate change to the template, with its own Undo, in the item sheet. The
 * dry run lists what changes before Confirm is on, and the toast undoes it.
 * Medium for a fixed amount, large with the keypad.
 */
export function ConfirmSheet({
	item,
	today,
	visible,
	onClose,
	onDone,
	onSkip,
}: {
	item: RecurringItem;
	/** Today as a calendar day in the server's zone (the summary's). */
	today: string;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
	onSkip: () => void;
}) {
	const t = useTranslations("mobile.recurring.confirm");
	const money = useMoneyText();
	const day = useDayText();
	const locale = useAmountLocale();
	const asks = item.amountMode === "ask";
	const currency = item.amount.currency;
	const usual = draftFromMinor(item.amount.minor, locale, currency);
	const [draft, setDraft] = useState(usual);
	const { space } = useTheme();
	const [paidOn, setPaidOn] = useState(item.next);
	const future = paidOn > today;
	const early = paidOn < item.paidOnFrom;
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const input =
		(asks && minor === null) || future || early
			? null
			: {
					id: item.id,
					dueAt: item.dueAt,
					...(asks && minor !== null
						? { amount: wireAmount(minor, currency) }
						: {}),
					// Only another day than the due date is sent.
					...(paidOn !== item.next ? { paidOn } : {}),
				};
	useResetOnOpen(visible, () => {
		setDraft(usual);
		setPaidOn(item.next);
	});
	const booked = asks && minor !== null ? { minor, currency } : item.amount;

	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges
					lead={[
						{ key: "next", label: t("nextDue"), value: day(item.nextAfter) },
					]}
					preview={preview}
					status={status}
				/>
			)}
			detent={asks ? "large" : "medium"}
			family="recurringConfirm"
			input={input}
			message={() => t("toast", { title: item.title, amount: money(booked) })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.recurring.previewConfirm(body)}
			submitLabel={t(item.direction === "in" ? "submitIn" : "submitOut")}
			title={t("title", { title: item.title })}
			visible={visible}
			write={(api, body, key) =>
				api.recurring.confirm(body, { context: { idempotencyKey: key } })
			}
		>
			{({ committing }) => (
				<>
					<Note>
						{t(item.direction === "in" ? "bodyIn" : "bodyOut", {
							date: day(item.next),
						})}
					</Note>
					<View style={{ gap: space[2] }}>
						<DateField
							label={t(item.direction === "in" ? "paidOnIn" : "paidOn")}
							minimum={item.paidOnFrom}
							onChange={setPaidOn}
							quick
							today={today}
							value={paidOn}
						/>
						{future ? <Note tone="attention">{t("future")}</Note> : null}
						{early ? (
							<Note tone="attention">
								{t("tooEarly", { date: day(item.paidOnFrom) })}
							</Note>
						) : null}
					</View>
					{asks ? (
						<AmountField
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("amount")}
							onDraftChange={setDraft}
						/>
					) : (
						<Note>{t("fixed", { amount: money(item.amount) })}</Note>
					)}
					<Button
						disabled={committing}
						label={t("skip")}
						onPress={onSkip}
						variant="text"
					/>
				</>
			)}
		</WriteSheet>
	);
}
