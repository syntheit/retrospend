"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useToast } from "~/components/ui/toast";
import { firstName } from "~/features/people/filter";
import { canConfirm, useRecurring } from "~/features/recurring/use-recurring";
import type {
	NeedsYouItem,
	NeedsYouList,
} from "~/server/services/needs-you/types";
import type { NeedsItemDTO } from "~/server/services/people/types";
import { api } from "~/trpc/react";

type ParticipantKind = "user" | "guest" | "shadow";

/** The People review sheet's item, from a split.review fact. */
export function toVerify(
	item: NeedsYouItem,
	people: NeedsYouList["people"],
): NeedsItemDTO | null {
	const key = item.people[0];
	const face = key ? people[key] : undefined;
	if (!key || !face || !item.entity || !item.amount || !item.date) return null;
	const [type, id] = key.split(":") as [ParticipantKind, string];
	return {
		kind: "verify",
		id: item.entity.id,
		person: {
			key: face.key,
			type,
			id,
			name: face.name,
			username: null,
			imageUrl: face.imageUrl,
			onRetrospend: face.onRetrospend,
		},
		title: item.title ?? "",
		amount: item.amount,
		date: item.date,
	};
}

/**
 * What each Needs you action does on Home. The sheets are the ones the
 * other pages use: People's review sheet, Recurring's confirm step, the
 * Add family. Links (imports, budget, settings) are the item's href and
 * never reach here.
 */
export function useNeedsActions(list: NeedsYouList | undefined) {
	const t = useTranslations("homePage.needs");
	const toast = useToast();
	const modal = useExpenseModal();
	const recurring = useRecurring();
	const confirm = api.settlement.paymentConfirm.useMutation();
	const unconfirm = api.settlement.paymentUnconfirm.useMutation();
	const resend = api.auth.resendVerificationEmail.useMutation();
	const [review, setReview] = useState<NeedsItemDTO | null>(null);
	const failed = useCallback(
		(e: unknown) => toast.failed(e instanceof Error ? e.message : t("failed")),
		[toast, t],
	);

	const confirmPayment = useCallback(
		async (item: NeedsYouItem) => {
			if (!item.entity || !list) return;
			const paymentId = item.entity.id;
			const key = item.people[0];
			const name = firstName((key && list.people[key]?.name) || "");
			try {
				await confirm.mutateAsync({ paymentId });
				toast.saved(t("confirmed", { name }), {
					undo: () => unconfirm.mutateAsync({ paymentId }),
				});
			} catch (e) {
				failed(e);
			}
		},
		[list, confirm, unconfirm, toast, t, failed],
	);

	const confirmRecurring = useCallback(
		(item: NeedsYouItem) => {
			const id = item.entity?.id;
			if (!id) return;
			const r = recurring.view.data?.items.find((x) => x.id === id);
			// A varying amount is asked in the recurring form until the Confirm sheet (2E).
			if (r && canConfirm(r)) recurring.askConfirm(r);
			else recurring.edit(id);
		},
		[recurring],
	);

	const run = useCallback(
		(item: NeedsYouItem) => {
			switch (item.type) {
				case "payment.confirm":
					return void confirmPayment(item);
				case "split.review":
					return setReview(list ? toVerify(item, list.people) : null);
				case "split.rejected":
					return item.entity && modal.openSharedExpense(item.entity.id);
				case "recurring.due":
				case "recurring.overdue":
					return confirmRecurring(item);
				case "setup.firstExpense":
					return modal.openNewExpense();
				case "setup.verifyEmail":
					return resend.mutate(undefined, {
						onSuccess: () => toast.saved(t("emailSent")),
						onError: failed,
					});
			}
		},
		[list, confirmPayment, confirmRecurring, modal, resend, toast, t, failed],
	);

	return {
		run,
		review,
		closeReview: () => setReview(null),
		recurring,
	};
}
