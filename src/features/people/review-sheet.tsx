"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { ChangesBlock } from "~/features/entry/changes";
import { firstName } from "./filter";
import type { NeedsItemDTO } from "./types";
import { useShareAnswer } from "./use-share-answer";

type Verify = Extract<NeedsItemDTO, { kind: "verify" }>;
type Answer = ReturnType<typeof useShareAnswer>;

/**
 * Review a split someone added you to: what it is and your share, then
 * Accept or Reject with an optional reason (B1: a reason is never sent
 * empty by accident; it is simply left out). What each answer changes comes
 * from the server's dry run of it, and a save that changed something ends
 * with an Undo toast.
 */
export function ReviewSheet({
	item,
	onClose,
}: {
	item: NeedsItemDTO | null;
	onClose: () => void;
}) {
	const t = useTranslations("peoplePage.review");
	const [shown, setShown] = useState<Verify | null>(null);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	useEffect(() => {
		if (item?.kind === "verify") {
			setShown(item);
			setRejecting(false);
			setReason("");
		}
	}, [item]);
	const open = item?.kind === "verify";
	const answer = useShareAnswer({
		item: open ? shown : null,
		rejecting,
		reason,
		onDone: onClose,
	});
	return (
		<Sheet
			detent={rejecting ? "large" : "medium"}
			footer={
				shown ? (
					<ReviewFooter
						answer={answer}
						onReason={setReason}
						onRejecting={setRejecting}
						reason={reason}
						rejecting={rejecting}
					/>
				) : (
					false
				)
			}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
			open={open}
			title={t("title")}
		>
			{shown && <ReviewBody answer={answer} item={shown} />}
		</Sheet>
	);
}

function ReviewBody({ item, answer }: { item: Verify; answer: Answer }) {
	const t = useTranslations("peoplePage.review");
	const { short } = useRowDates();
	return (
		<div className="flex flex-col gap-3 pb-2">
			<p className="text-body text-fg">
				{t("sentence", {
					name: firstName(item.person.name),
					title: item.title,
				})}
			</p>
			<div className="border-line flex items-center justify-between border-t pt-3">
				<span className="text-fg-2 text-body">{t("yourShare")}</span>
				<Money
					className="text-fg text-body font-semibold"
					value={item.amount}
				/>
			</div>
			<div className="border-line flex items-center justify-between border-t pt-3">
				<span className="text-fg-2 text-body">{t("date")}</span>
				<span className="text-fg text-body">{short(item.date)}</span>
			</div>
			<ChangesBlock
				cannot={answer.dry.error}
				diff={answer.dry.data}
				loading={answer.dry.loading}
			/>
		</div>
	);
}

function ReviewFooter({
	answer,
	rejecting,
	reason,
	onRejecting,
	onReason,
}: {
	answer: Answer;
	rejecting: boolean;
	reason: string;
	onRejecting: (rejecting: boolean) => void;
	onReason: (reason: string) => void;
}) {
	const t = useTranslations("peoplePage.review");
	const ready = answer.dry.fresh && !answer.saving;
	if (rejecting)
		return (
			<div className="flex w-full flex-col gap-2">
				<Label htmlFor="review-reason">{t("reason")}</Label>
				<Textarea
					autoFocus
					className="border-line-strong rounded-ctl text-body"
					id="review-reason"
					maxLength={500}
					onChange={(e) => onReason(e.target.value)}
					rows={3}
					value={reason}
				/>
				<div className="flex justify-end gap-2">
					<Button kind="secondary" onClick={() => onRejecting(false)}>
						{t("back")}
					</Button>
					<Button
						disabled={!ready}
						kind="danger"
						loading={answer.saving}
						onClick={() => void answer.send()}
					>
						{t("reject")}
					</Button>
				</div>
			</div>
		);
	return (
		<>
			<Button kind="secondary" onClick={() => onRejecting(true)}>
				{t("reject")}
			</Button>
			<Button
				disabled={!ready}
				kind="primary"
				loading={answer.saving}
				onClick={() => void answer.send()}
			>
				{t("accept")}
			</Button>
		</>
	);
}
