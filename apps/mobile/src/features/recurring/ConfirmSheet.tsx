import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { minorOf, readAmount, wireAmount } from "@/features/budget/amount";
import {
	AmountField,
	Note,
	SheetBody,
	useAmountLocale,
} from "@/features/budget/parts";
import { useMoneyWrite, useWriteIds } from "@/features/budget/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/budget/WriteFrame";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
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
 * is typed here; a fixed one is shown. The dry run lists what changes before
 * Confirm is on, and the toast undoes it.
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
	const api = useApi();
	const announce = useRecurringToast();
	const undoOf = useConfirmUndo();
	const money = useMoneyText();
	const day = useDayText();
	const locale = useAmountLocale();
	const asks = item.amountMode === "ask";
	const currency = item.amount.currency;
	const [draft, setDraft] = useState("");
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty with a fresh write id
	useEffect(() => {
		if (!visible) return;
		setDraft("");
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
			detents={["large"]}
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
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
