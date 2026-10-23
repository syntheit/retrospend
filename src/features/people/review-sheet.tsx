"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { firstName } from "./filter";
import type { NeedsItemDTO } from "./types";

type Verify = Extract<NeedsItemDTO, { kind: "verify" }>;

/**
 * Review a split someone added you to: what it is and your share, then
 * Accept or Reject with an optional reason (B1: a reason is never sent
 * empty by accident; it is simply left out).
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
	useEffect(() => {
		if (item?.kind === "verify") setShown(item);
	}, [item]);
	const open = item?.kind === "verify";
	return (
		<Sheet
			detent="medium"
			footer={shown ? <ReviewFooter item={shown} onDone={onClose} /> : false}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
			open={open}
			title={t("title")}
		>
			{shown && <ReviewBody item={shown} />}
		</Sheet>
	);
}

function ReviewBody({ item }: { item: Verify }) {
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
		</div>
	);
}

function ReviewFooter({ item, onDone }: { item: Verify; onDone: () => void }) {
	const t = useTranslations("peoplePage.review");
	const toast = useToast();
	const router = useRouter();
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const accept = api.verification.accept.useMutation();
	const reject = api.verification.reject.useMutation();
	const done = (message: string) => {
		router.refresh();
		toast.saved(message);
		onDone();
	};
	const fail = (e: unknown) =>
		toast.failed(e instanceof Error ? e.message : t("failed"));
	if (rejecting)
		return (
			<div className="flex w-full flex-col gap-2">
				<Label htmlFor="review-reason">{t("reason")}</Label>
				<Textarea
					autoFocus
					className="border-line-strong rounded-ctl text-body"
					id="review-reason"
					maxLength={500}
					onChange={(e) => setReason(e.target.value)}
					rows={3}
					value={reason}
				/>
				<div className="flex justify-end gap-2">
					<Button kind="secondary" onClick={() => setRejecting(false)}>
						{t("back")}
					</Button>
					<Button
						kind="danger"
						loading={reject.isPending}
						onClick={() =>
							reject
								.mutateAsync({
									txnId: item.id,
									reason: reason.trim() || undefined,
								})
								.then(() => done(t("rejected", { title: item.title })))
								.catch(fail)
						}
					>
						{t("reject")}
					</Button>
				</div>
			</div>
		);
	return (
		<>
			<Button kind="secondary" onClick={() => setRejecting(true)}>
				{t("reject")}
			</Button>
			<Button
				kind="primary"
				loading={accept.isPending}
				onClick={() =>
					accept
						.mutateAsync({ txnId: item.id })
						.then(() => done(t("accepted", { title: item.title })))
						.catch(fail)
				}
			>
				{t("accept")}
			</Button>
		</>
	);
}
