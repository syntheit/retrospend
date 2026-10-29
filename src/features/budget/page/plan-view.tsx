"use client";

import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { useIsMobile } from "~/hooks/use-mobile";
import { generateId } from "~/lib/id";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { PlanLine } from "~/lib/schemas/envelope-plan";
import { api } from "~/trpc/react";
import { useMonthLabel } from "./month-switch";
import { monthStartIso } from "./months";
import { isPlanConflict, planSaveId } from "./plan-draft";
import { PlanList, PlanTable } from "./plan-rows";
import type { BudgetActions } from "./use-budget-actions";
import { isLimits } from "./view-model";

type Source = "TARGETS" | "SAME_AS_THIS_MONTH" | "THIS_MONTH_SPENT";
const SOURCES: Source[] = ["TARGETS", "SAME_AS_THIS_MONTH", "THIS_MONTH_SPENT"];

/**
 * Plan next month (SPEC §5.13, D2, B4, budget.html): a draft over the real
 * budget. It never touches money until Apply, so saving a line and Discard
 * are not money actions; Apply and Fund it now open their own sheets with the
 * preview (R30). Planned and Left are the server's dry run of the draft.
 */
export function PlanView({
	data,
	thisMonth,
	actions,
}: {
	data: GetMonthOutput;
	/** The month before it, for what each envelope spent there. */
	thisMonth: GetMonthOutput | undefined;
	actions: BudgetActions;
}) {
	const t = useTranslations("budgetPage.plan");
	const toast = useToast();
	const utils = api.useUtils();
	const label = useMonthLabel();
	const { month: monthName } = useRowDates();
	const isMobile = useIsMobile();
	const month = data.month.key;
	const drafts = api.envelope.drafts.useQuery({ kind: "PLAN", month });
	const draft = drafts.data?.open ?? drafts.data?.saved ?? null;
	const preview = api.envelope.previewDraft.useQuery(
		{ draftId: draft?.id ?? "" },
		{ enabled: draft != null },
	);
	const refresh = () =>
		Promise.all([
			utils.envelope.drafts.invalidate(),
			utils.envelope.previewDraft.invalidate(),
			utils.envelope.planCost.invalidate(),
		]);
	const save = api.envelope.saveDraft.useMutation({
		onSuccess: refresh,
		// A plan opened on another device: read it, so the next save edits it.
		onError: (error) => {
			if (!isPlanConflict(error)) return;
			void refresh();
			toast.info(t("changedElsewhere"));
		},
	});
	const discard = api.envelope.discardDraft.useMutation({ onSuccess: refresh });

	const lines = useMemo(
		() =>
			new Map((preview.data?.envelopes ?? []).map((l) => [l.envelopeId, l])),
		[preview.data],
	);
	const planned = useMemo(
		() =>
			new Map((draft?.lines ?? []).map((l) => [l.envelopeId, l.amountMinor])),
		[draft],
	);
	const spent = useMemo(
		() =>
			new Map(
				(thisMonth?.groups ?? [])
					.flatMap((g) => g.envelopes)
					.map((e) => [e.id, e.spent]),
			),
		[thisMonth],
	);

	const write = (next: PlanLine[]) =>
		save.mutateAsync({
			id: planSaveId(drafts.data, generateId),
			kind: "PLAN",
			month,
			lines: next,
			moves: [],
			expectedIn: draft?.expectedIn ?? [],
			pretend: [],
		});
	const fill = async (source: Source) => {
		const filled = await utils.envelope.planFill.fetch({ source });
		await write(filled.lines);
	};
	/** One envelope's plan, from its input: the other lines stay as they are. */
	const setPlanned = (envelopeId: string, amountMinor: number) =>
		write([
			...(draft?.lines ?? []).filter((l) => l.envelopeId !== envelopeId),
			{ envelopeId, amountMinor },
		]);

	const discardDraft = () => {
		if (!draft) return;
		const { lines: kept, expectedIn } = draft;
		discard.mutate(
			{ draftId: draft.id },
			{
				onSuccess: () =>
					toast.saved(t("discarded"), {
						undo: () =>
							save.mutateAsync({
								id: generateId(),
								kind: "PLAN",
								month,
								lines: kept,
								moves: [],
								expectedIn,
								pretend: [],
							}),
					}),
			},
		);
	};

	const fillChips = (
		<FilterChips label={t("fillLabel")}>
			{SOURCES.map((s) => (
				<FilterChip
					disabled={save.isPending}
					key={s}
					onClick={() => void fill(s)}
				>
					{t(`fill.${s}`, {
						month: monthName(monthStartIso(thisMonth?.month.key ?? month)),
					})}
				</FilterChip>
			))}
		</FilterChips>
	);

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
									{t(`fill.${s}`, {
										month: monthName(
											monthStartIso(thisMonth?.month.key ?? month),
										),
									})}
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

	const canFund =
		(preview.data?.fundNow?.minor ?? 0) > 0 && actions.can("fundNow");
	return (
		<div data-slot="plan-view">
			<Notice
				action={
					<div className="flex flex-wrap items-center gap-2">
						{canFund && (
							<Button
								kind="ghost"
								onClick={() => actions.sheet.open("fundNow", { month })}
								size="sm"
							>
								{t("fundNow")}
							</Button>
						)}
						<Button kind="secondary" onClick={discardDraft} size="sm">
							{t("discard")}
						</Button>
						{actions.can("planApply") && (
							<Button
								kind="primary"
								onClick={() => actions.sheet.open("planApply", { month })}
								size="sm"
							>
								{t("apply")}
							</Button>
						)}
					</div>
				}
			>
				<span className="block font-medium">
					{t("bannerTitle", { month: label(month) })}
				</span>
				<span className="text-fg-2 text-small block">
					{t("bannerSub", {
						current: monthName(monthStartIso(thisMonth?.month.key ?? month)),
						month: monthName(monthStartIso(month)),
					})}
				</span>
			</Notice>
			{isLimits(data.book.style) ? (
				<div className="mt-6" />
			) : (
				<div className="mt-6 mb-4">
					<div className="text-fg-2 text-small">
						{t("after", { month: monthName(monthStartIso(month)) })}
					</div>
					{preview.data ? (
						<Money
							className="text-hero text-fg block"
							value={preview.data.toAssign.after}
						/>
					) : (
						<Skeleton className="h-8 w-48" shape="money" />
					)}
				</div>
			)}
			<div className="mb-4">{fillChips}</div>
			{isMobile ? (
				<PlanList
					groups={data.groups}
					lines={lines}
					onEdit={
						actions.can("planEdit")
							? (envelopeId) =>
									actions.sheet.open("planEdit", { month, envelopeId })
							: undefined
					}
				/>
			) : (
				<PlanTable
					currency={data.book.currency}
					groups={data.groups}
					lines={lines}
					monthLabel={monthName(monthStartIso(thisMonth?.month.key ?? month))}
					onPlan={setPlanned}
					planLabel={monthName(monthStartIso(month))}
					planned={planned}
					spent={spent}
				/>
			)}
		</div>
	);
}
