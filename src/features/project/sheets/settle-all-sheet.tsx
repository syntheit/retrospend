"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { PageView } from "../types";
import { PreviewLines } from "./preview-lines";

/**
 * Settle all (R30, R15): the payments that settle every balance you have in
 * this project, one per person and currency, from a dry run of the same
 * mutation Record runs; then what that changes and what it does not. The
 * save ends with Undo, which takes the payments back.
 */
export function SettleAllSheet({
	view,
	onOpenChange,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.settleAll");
	const tp = useTranslations("projectV2.preview.figures");
	const toast = useToast();
	const utils = api.useUtils();
	const preview = api.project.settleAllPreview.useQuery(
		{ projectId: view.id },
		{ gcTime: 0, staleTime: 0 },
	);
	const refresh = () => utils.project.invalidate();
	const apply = api.project.settleAll.useMutation({ onSuccess: refresh });
	const undo = api.project.settleAllUndo.useMutation({ onSuccess: refresh });
	const lines = preview.data?.value.lines ?? [];
	const person = (key: string) => view.members.find((m) => m.id === key);

	const submit = async () => {
		const result = await apply.mutateAsync({ projectId: view.id });
		const ids = result.value.lines.map((l) => l.paymentId);
		toast.saved(t("done", { count: ids.length }), {
			undo: () => undo.mutateAsync({ projectId: view.id, paymentIds: ids }),
		});
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitDisabled={preview.isPending || lines.length === 0}
			submitLabel={t("submit", { count: lines.length })}
			title={t("title")}
		>
			<div className="flex flex-col gap-6">
				{preview.isError ? (
					<p className="text-danger text-small" role="alert">
						{preview.error.message}
					</p>
				) : preview.isPending ? null : lines.length === 0 ? (
					<p className="text-fg-2 text-body">{t("even")}</p>
				) : (
					<RowList label={t("payments")} variant="flat">
						{lines.map((l) => {
							const p = person(l.person);
							const name = p?.name ?? t("someone");
							const incoming = l.direction === "incoming";
							return (
								<Row
									end={<Money className="font-semibold" value={l.amount} />}
									key={`${l.person}-${l.amount.currency}`}
									lead={
										<Face imageUrl={p?.imageUrl} name={name} size="default" />
									}
									sub={
										<RowSub
											parts={[
												incoming
													? t("recordedAsPaid")
													: p?.onRetrospend
														? t("theyConfirm", { name })
														: t("finalNow"),
											]}
										/>
									}
									title={
										incoming ? t("paysYou", { name }) : t("youPay", { name })
									}
								/>
							);
						})}
					</RowList>
				)}
				<PreviewLines
					label={(id) => tp(id.replaceAll(".", "_"))}
					loading={preview.isPending}
					preview={preview.data}
				/>
			</div>
		</Sheet>
	);
}
