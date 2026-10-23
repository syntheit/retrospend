"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { PaymentTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useToast } from "~/components/ui/toast";
import type { PaymentDTO } from "~/features/people/types";
import { api } from "~/trpc/react";

export const paymentTargetOf = (
	p: PaymentDTO,
	name: string,
): PaymentTarget => ({
	id: p.id,
	name,
	waitsForMe: p.status === "pending" && !p.recordedByMe,
});

/**
 * The payment entity's handlers (R8): Confirm a payment someone says they
 * made to you (then Undo, which puts their record back as they made it),
 * or say it never arrived (a named confirm first; your balance stays).
 */
export function usePaymentActions(name: string) {
	const t = useTranslations("personPage.toast");
	const toast = useToast();
	const router = useRouter();
	const confirm = api.settlement.paymentConfirm.useMutation();
	const unconfirm = api.settlement.paymentUnconfirm.useMutation();
	const reject = api.settlement.reject.useMutation();
	const fail = useCallback(
		(e: unknown) => toast.failed(e instanceof Error ? e.message : t("failed")),
		[toast, t],
	);
	return useCallback(
		(p: PaymentDTO): ActionHandlers<PaymentTarget> => ({
			confirm: () =>
				confirm
					.mutateAsync({ paymentId: p.id })
					.then(() => {
						router.refresh();
						toast.saved(t("confirmed", { name }), {
							undo: async () => {
								await unconfirm.mutateAsync({ paymentId: p.id });
								router.refresh();
							},
						});
					})
					.catch(fail),
			notReceived: () =>
				reject
					.mutateAsync({ id: p.rowId ?? p.id })
					.then(() => {
						router.refresh();
						toast.saved(t("notReceived", { name }));
					})
					.catch(fail),
		}),
		[confirm, unconfirm, reject, router, toast, t, name, fail],
	);
}
