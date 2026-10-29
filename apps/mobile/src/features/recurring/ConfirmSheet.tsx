import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import {
	AmountField,
	Note,
	SheetBody,
	useAmountLocale,
} from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { DateField } from "@/ui/DateField";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import type { RecurringItem } from "./source";
import { useConfirmUndo, useRecurringToast } from "./useRecurringToast";

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
 * (the due date, today when it is overdue, or a day picked); the rate follows
 * that day. A varying amount (amountMode ask) starts at the usual amount and
 * is edited here; a fixed one is shown, since the server keeps it fixed.
 * Skip this time hands over to the skip sheet. Auto-pay is not here: it is a
 * separate change to the template, with its own Undo, in the item sheet. The
 * dry run lists what changes before Confirm is on, and the toast undoes it.
 * Medium for a fixed amount, large with the keypad.
 */
type PaidOn = "due" | "today" | "pick";

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
	const api = useApi();
	const announce = useRecurringToast();
	const undoOf = useConfirmUndo();
	const money = useMoneyText();
	const day = useDayText();
	const locale = useAmountLocale();
	const asks = item.amountMode === "ask";
	const currency = item.amount.currency;
	const usual = draftFromMinor(item.amount.minor, locale, currency);
	const [draft, setDraft] = useState(usual);
	const { space } = useTheme();
	const overdue = item.next < today;
	const [paidMode, setPaidMode] = useState<PaidOn>("due");
	const [picked, setPicked] = useState(today);
	const future = paidMode === "pick" && picked > today;
	const early = paidMode === "pick" && picked < item.paidOnFrom;
	const paidOn =
		paidMode === "today" ? today : paidMode === "pick" ? picked : item.next;
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
	const { idFor, reset } = useWriteIds(input ? JSON.stringify(input) : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts at the usual amount with a fresh write id
	useEffect(() => {
		if (!visible) return;
		setDraft(usual);
		setPaidMode("due");
		setPicked(today);
		reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: input ? idFor("write") : null,
		preview: (body) => (api ? api.recurring.previewConfirm(body) : noSession()),
		write: (body, key) =>
			api
				? api.recurring.confirm(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		const booked = asks && minor !== null ? { minor, currency } : item.amount;
		announce({
			message: t("toast", { title: item.title, amount: money(booked) }),
			undo: undoOf(out.undo),
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={[asks ? "large" : "medium"]}
			onClose={onClose}
			title={t("title", { title: item.title })}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						<PreviewChanges
							lead={[
								{
									key: "next",
									label: t("nextDue"),
									value: day(item.nextAfter),
								},
							]}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={t(item.direction === "in" ? "submitIn" : "submitOut")}
				>
					<Note>
						{t(item.direction === "in" ? "bodyIn" : "bodyOut", {
							date: day(item.next),
						})}
					</Note>
					<View style={{ gap: space[2] }}>
						<Text tone="fg2" variant="small" weight="medium">
							{t(item.direction === "in" ? "paidOnIn" : "paidOn")}
						</Text>
						<Segmented
							accessibilityLabel={t(
								item.direction === "in" ? "paidOnIn" : "paidOn",
							)}
							onChange={setPaidMode}
							options={[
								{
									value: "due",
									label: overdue
										? t("paidOnDue", { date: day(item.next) })
										: t("paidOnDueToday"),
								},
								...(overdue
									? [{ value: "today" as const, label: t("paidOnToday") }]
									: []),
								{ value: "pick", label: t("paidOnPick") },
							]}
							value={paidMode}
						/>
						{paidMode === "pick" ? (
							<DateField
								label={t("pickDate")}
								minimum={item.paidOnFrom}
								onChange={setPicked}
								value={picked}
							/>
						) : null}
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
						disabled={flow.committing}
						label={t("skip")}
						onPress={onSkip}
						variant="text"
					/>
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
