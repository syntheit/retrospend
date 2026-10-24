"use client";

import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { useIsMobile } from "~/hooks/use-mobile";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import { useMonthLabel } from "./month-switch";
import { PlanList, PlanTable } from "./plan-rows";
import type { BudgetActions } from "./use-budget-actions";

type Source = "TARGETS" | "SAME_AS_THIS_MONTH" | "THIS_MONTH_SPENT";
const SOURCES: Source[] = ["TARGETS", "SAME_AS_THIS_MONTH", "THIS_MONTH_SPENT"];

/**
 * Plan next month (SPEC §5.13, D2, B4): a draft over the real budget. It
 * never touches money until Apply, so Save and Discard here are not money
 * actions; Apply opens its own sheet with the preview (R30). The preview
 * numbers (Planned, Left, Not planned yet after) are the server's dry run.
 */
export function PlanView({
	data,
	actions,
}: {
	data: GetMonthOutput;
	actions: BudgetActions;
}) {
	const t = useTranslations("budgetPage.plan");
	const toast = useToast();
	const utils = api.useUtils();
	const label = useMonthLabel();
	const isMobile = useIsMobile();
	const month = data.month.key;
	const drafts = api.envelope.drafts.useQuery({ kind: "PLAN", month });
	const draft = drafts.data?.open ?? drafts.data?.saved ?? null;
	const preview = api.envelope.previewDraft.useQuery(
		{ draftId: draft?.id ?? "" },
		{ enabled: draft != null },
	);
	const edit = (envelopeId: string) =>
		actions.sheet.open("planEdit", { month, envelopeId });
	const refresh = () => utils.envelope.drafts.invalidate();
	const save = api.envelope.saveDraft.useMutation({ onSuccess: refresh });
	const discard = api.envelope.discardDraft.useMutation({ onSuccess: refresh });

	const lines = useMemo(
		() =>
			new Map((preview.data?.envelopes ?? []).map((l) => [l.envelopeId, l])),
		[preview.data],
	);

	const fill = async (source: Source) => {
		const filled = await utils.envelope.planFill.fetch({ source });
		save.mutate({
			id: crypto.randomUUID(),
			kind: "PLAN",
			month,
			lines: filled.lines,
			moves: [],
			expectedIn: [],
			pretend: [],
		});
	};

	const discardDraft = () => {
		if (!draft) return;
		const { lines: kept } = draft;
		discard.mutate(
			{ draftId: draft.id },
			{
				onSuccess: () =>
					toast.saved(t("discarded"), {
						undo: () =>
							save.mutateAsync({
								id: crypto.randomUUID(),
								kind: "PLAN",
								month,
								lines: kept,
								moves: [],
								expectedIn: [],
								pretend: [],
							}),
					}),
			},
		);
	};

	if (drafts.isPending)
		return (
			<div aria-busy="true" data-slot="plan-view">
				<Skeleton className="h-40 w-full" shape="line" />
			</div>
		);
	if (!draft)
		return (
			<div data-slot="plan-view">
				<Empty
					action={
						<div className="flex flex-wrap justify-center gap-2">
							{SOURCES.map((s, i) => (
								<Button
									key={s}
									kind={i === 0 ? "primary" : "secondary"}
									loading={save.isPending}
									onClick={() => void fill(s)}
									size="sm"
								>
									{t(`fill.${s}`)}
								</Button>
							))}
						</div>
					}
					hint={t("emptyHint")}
					icon={NotebookPen}
					title={t("emptyTitle", { month: label(month) })}
				/>
			</div>
		);

	return (
		<div data-slot="plan-view">
			<Notice
				action={
					<div className="flex gap-2">
						<Button kind="ghost" onClick={discardDraft} size="sm">
							{t("discard")}
						</Button>
						<Button
							kind="primary"
							onClick={() => actions.sheet.open("planApply", { month })}
							size="sm"
						>
							{t("apply")}
						</Button>
					</div>
				}
			>
				{t("banner", { month: label(month) })}
			</Notice>
			<div className="my-6 flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="text-fg-2 text-small">{t("after")}</div>
					{preview.data ? (
						<Money
							className="text-hero text-fg block"
							value={preview.data.toAssign.after}
						/>
					) : (
						<Skeleton className="h-8 w-48" shape="money" />
					)}
				</div>
				<div className="flex items-center gap-2">
					{(preview.data?.fundNow?.minor ?? 0) > 0 && (
						<Button
							kind="secondary"
							onClick={() => actions.sheet.open("fundNow", { month })}
							size="sm"
						>
							{t("fundNow")}
						</Button>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button kind="secondary" size="sm">
								{t("fillFrom")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{SOURCES.map((s) => (
								<DropdownMenuItem key={s} onSelect={() => void fill(s)}>
									{t(`fill.${s}`)}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{isMobile ? (
				<PlanList groups={data.groups} lines={lines} onEdit={edit} />
			) : (
				<PlanTable groups={data.groups} lines={lines} onEdit={edit} />
			)}
		</div>
	);
}
