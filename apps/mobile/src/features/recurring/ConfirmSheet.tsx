import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
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
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
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
 * Confirm a due recurring expense or income: the server books the entry for
 * the due date and moves the template on. A varying amount (amountMode ask)
 * starts at the usual amount and is edited here; a fixed one is shown, since
 * the server books it as it is. The auto-pay switch changes the template with
 * the confirm. The dry run lists what changes before Confirm is on, and the
 * toast undoes it. Medium when only the switch is asked, large with the
 * keypad.
 */
export function ConfirmSheet({
	item,
	visible,
	onClose,
	onDone,
}: {
	item: RecurringItem;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring.confirm");
	const ti = useTranslations("mobile.recurring.item");
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
	const [autoPay, setAutoPay] = useState(item.autoPay);
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const input =
		asks && minor === null
			? null
			: {
					id: item.id,
					dueAt: item.dueAt,
					...(asks && minor !== null
						? { amount: wireAmount(minor, currency) }
						: {}),
				};
	const { idFor, reset } = useWriteIds(input ? JSON.stringify(input) : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts at the usual amount with a fresh write id
	useEffect(() => {
		if (!visible) return;
		setDraft(usual);
		setAutoPay(item.autoPay);
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
		// The template's auto-pay follows the switch. The booking above stands
		// either way, so a refusal here only leaves auto-pay as it was.
		if (api && autoPay !== item.autoPay) {
			try {
				await api.recurring.update(
					{ id: item.id, autoPay },
					{ context: { idempotencyKey: newClientId() } },
				);
			} catch {
				// The list shows auto-pay as it is, one tap from the switch.
			}
		}
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
								...(autoPay !== item.autoPay
									? [
											{
												key: "autoPay",
												label: ti("autoPay"),
												value: t(autoPay ? "autoOn" : "autoOff"),
											},
										]
									: []),
							]}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={t("submit")}
				>
					<Note>
						{t(item.direction === "in" ? "bodyIn" : "bodyOut", {
							date: day(item.next),
						})}
					</Note>
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
					<SwitchRow
						detail={ti(autoPay ? "autoOnHint" : "autoOffHint")}
						label={ti("autoPay")}
						onChange={setAutoPay}
						value={autoPay}
					/>
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
