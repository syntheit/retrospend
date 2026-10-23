"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";
import { inOurWords } from "../errors";
import type { PageView } from "../types";
import { PreviewLines } from "./preview-lines";

type Plan = RouterOutputs["project"]["settleAllPreview"]["value"];

/** The payments to record, then the lines left for the person (they say they paid). */
function PlanRows({ plan, view }: { plan: Plan; view: PageView }) {
	const t = useTranslations("projectV2.settleAll");
	const member = (key: string) => view.members.find((m) => m.id === key);
	const rows = [
		...plan.lines.map((l) => ({ ...l, skipped: null })),
		...plan.skipped.map((l) => ({ ...l, skipped: l.reason })),
	];
	return (
		<RowList label={t("payments")} variant="flat">
			{rows.map((l) => {
				const p = member(l.person);
				const name = p?.name ?? t("someone");
				const incoming = l.direction === "incoming";
				const sub = l.skipped
					? l.skipped === "matches_claim"
						? t("claimed", { name })
						: t("skippedOther")
					: incoming
						? t("recordedAsPaid")
						: p?.onRetrospend
							? t("theyConfirm", { name })
							: t("finalNow");
				return (
					<Row
						end={
							<Money
								className={l.skipped ? "text-fg-3" : "font-semibold"}
								value={l.amount}
							/>
						}
						key={`${l.person}-${l.amount.currency}`}
						lead={<Face imageUrl={p?.imageUrl} name={name} size="default" />}
						sub={<RowSub parts={[sub]} />}
						title={incoming ? t("paysYou", { name }) : t("youPay", { name })}
					/>
				);
			})}
		</RowList>
	);
}

/**
 * Settle all (R30, R15): the payments that settle every balance you have in
 * this project, one per person and currency, from a dry run of the same
 * mutation Record runs; then what that changes and what it does not. Record
 * sends back the lines it showed; when the balances moved meanwhile the
 * server refuses, and the sheet checks again. The save ends with Undo,
 * which takes all the payments back or none.
 */
export function SettleAllSheet({
	view,
	onOpenChange,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.settleAll");
	const te = useTranslations("projectV2.errors");
	const tp = useTranslations("projectV2.preview.figures");
	const ti = useTranslations("projectV2.preview.figuresInline");
	const toast = useToast();
	const utils = api.useUtils();
	const preview = api.project.settleAllPreview.useQuery(
		{ projectId: view.id },
		{ gcTime: 0, staleTime: 0 },
	);
	const refresh = () => utils.project.invalidate();
	const apply = api.project.settleAll.useMutation({ onSuccess: refresh });
	const undo = api.project.settleAllUndo.useMutation({ onSuccess: refresh });
	const plan = preview.data?.value;
	const lines = plan?.lines ?? [];

	const submit = async () => {
		if (!plan) return false;
		const result = await inOurWords(
			() =>
				apply.mutateAsync({ projectId: view.id, expect: [...plan.planned] }),
			te("failed"),
			{ CONFLICT: te("changed") },
		).catch(async (error: Error) => {
			await preview.refetch();
			throw error;
		});
		const ids = result.value.lines.map((l) => l.paymentId);
		toast.saved(t("done", { count: ids.length }), {
			undo: () =>
				inOurWords(
					() => undo.mutateAsync({ projectId: view.id, paymentIds: ids }),
					te("failed"),
					{ CONFLICT: te("undoConflict") },
				),
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
						{te("previewFailed")}
					</p>
				) : !plan ? null : plan.planned.length === 0 ? (
					<p className="text-fg-2 text-body">{t("even")}</p>
				) : (
					<PlanRows plan={plan} view={view} />
				)}
				<PreviewLines
					inline={(id) => ti(id.replaceAll(".", "_"))}
					label={(id) => tp(id.replaceAll(".", "_"))}
					loading={preview.isPending}
					preview={preview.data}
				/>
			</div>
		</Sheet>
	);
}
