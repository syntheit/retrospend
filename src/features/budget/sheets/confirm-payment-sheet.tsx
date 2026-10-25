"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Face } from "~/components/ui/avatar-face";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { firstName } from "~/features/people/filter";
import { api } from "~/trpc/react";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";

/**
 * Confirm a payment someone says they made (SPEC §6.9, D8): until you
 * confirm it, it is shown and not counted. The server previews what
 * confirming changes (what they owe, and what returns to Not planned yet)
 * and Undo makes it wait for you again.
 */
export function ConfirmPaymentSheet({
	open,
	onClose,
	month,
	paymentId,
}: SheetProps<{ paymentId: string }>) {
	const t = useTranslations("budgetSheets.confirmPayment");
	const { short } = useRowDates();
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const utils = api.useUtils();
	const people = api.people.overview.useQuery();
	const confirm = api.settlement.paymentConfirm.useMutation();
	const unconfirm = api.settlement.paymentUnconfirm.useMutation();
	const item = people.data?.needs.find(
		(n) => n.kind === "confirmPayment" && n.id === paymentId,
	);
	const waiting = item?.kind === "confirmPayment" ? item : null;
	const name = firstName(waiting?.person.name ?? "");
	const w = useMoneyWrite({
		input: waiting ? { paymentId } : null,
		preview: (i) =>
			utils.settlement.paymentConfirmPreview.fetch(i, { staleTime: 0 }),
		commit: (i) => confirm.mutateAsync(i),
		toast: () => t("toast", { name }),
		undo: (_r, i) => () => unconfirm.mutateAsync({ paymentId: i.paymentId }),
	});
	return (
		<Sheet
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("confirm")}
			title={t("title", { name })}
		>
			{people.isLoading || m.loading ? (
				<SkeletonRows count={3} />
			) : !waiting ? (
				<p className="text-fg-2 text-small">{t("none")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<div className="flex items-center gap-3">
						<Face name={waiting.person.name} />
						<p className="text-fg-2 text-small">
							{t.rich("says", {
								name,
								amount: () => <Money value={waiting.amount} />,
								date: short(waiting.paidOn),
							})}
						</p>
					</div>
					<FigureChanges dry={w.dry} poolName={pool} />
				</div>
			)}
		</Sheet>
	);
}
