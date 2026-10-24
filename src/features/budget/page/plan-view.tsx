"use client";

import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { Money } from "~/components/money/money";
import { RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { useToast } from "~/components/ui/toast";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { DraftPreview } from "~/lib/schemas/envelope-plan";
import { api } from "~/trpc/react";
import { useGroupName } from "./group-parts";
import { useMonthLabel } from "./month-switch";
import { useTargetParts } from "./target-line";
import type { BudgetActions } from "./use-budget-actions";
import { groupKey, toEnvelopeVM } from "./view-model";

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
	const name = useGroupName();
	const parts = useTargetParts();
	const month = data.month.key;
	const drafts = api.envelope.drafts.useQuery({ kind: "PLAN", month });
	const draft = drafts.data?.open ?? drafts.data?.saved ?? null;
	const preview = api.envelope.previewDraft.useQuery(
		{ draftId: draft?.id ?? "" },
		{ enabled: draft != null },
	);
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
			<div className="my-6 flex items-end justify-between gap-4">
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
			<Table aria-label={t("table")} look="panel">
				<TableHeader>
					<TableRow>
						<TableHead className="w-2/5">{t("envelope")}</TableHead>
						<TableHead className="text-right">{t("planned")}</TableHead>
						<TableHead className="text-right">{t("left")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{data.groups.map((g) => (
						<GroupRows
							groupName={name(g)}
							key={groupKey(g)}
							lines={lines}
							onEdit={(envelopeId) =>
								actions.sheet.open("planEdit", { month, envelopeId })
							}
							parts={parts}
							rows={g.envelopes}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

type Lines = ReadonlyMap<string, DraftPreview["envelopes"][number]>;

function GroupRows({
	groupName,
	rows,
	lines,
	parts,
	onEdit,
}: {
	groupName: string;
	rows: GetMonthOutput["groups"][number]["envelopes"];
	lines: Lines;
	parts: ReturnType<typeof useTargetParts>;
	onEdit: (envelopeId: string) => void;
}) {
	const t = useTranslations("budgetPage.plan");
	return (
		<>
			<TableRow>
				<TableCell className="text-body text-fg font-medium" colSpan={3}>
					{groupName}
				</TableCell>
			</TableRow>
			{rows.map((e) => {
				const line = lines.get(e.id);
				const vm = toEnvelopeVM(e);
				return (
					<TableRow data-envelope={e.id} key={e.id}>
						<TableCell>
							<div className="flex items-center gap-3">
								<CategoryTile category={vm.category} />
								<div className="min-w-0 leading-snug">
									<Button
										aria-label={t("edit", { name: e.name })}
										className="text-body text-fg h-auto justify-start px-0 font-medium"
										kind="ghost"
										onClick={() => onEdit(e.id)}
									>
										<span className="truncate">{e.name}</span>
									</Button>
									<RowSub parts={parts(e, { needed: false })} />
								</div>
							</div>
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{line ? <Money value={line.assigned.after} /> : null}
						</TableCell>
						<TableCell className="text-right tabular-nums">
							<div className="flex justify-end">
								{line ? (
									line.short ? (
										<AvailablePill
											amount={line.left.after}
											status="underfunded"
										/>
									) : (
										<Money className="font-semibold" value={line.left.after} />
									)
								) : null}
							</div>
						</TableCell>
					</TableRow>
				);
			})}
		</>
	);
}
