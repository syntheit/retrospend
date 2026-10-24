"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { AssignSheet } from "./assign-sheet";
import { EnvelopeTile } from "./envelope-tile";
import { FigureChanges } from "./figure-changes";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";
import { useBudgetWrite } from "./use-write";

type UsePlan = RouterInputs["envelope"]["usePlan"];
type Fill = RouterOutputs["envelope"]["fillFromTargets"];
type Choice = UsePlan["rest"];
type Line = Fill["lines"][number];

/**
 * Use my plan (owner N72, RC-5): money with no job gets its jobs from your
 * targets in one tap. Every line is listed, then where the rest goes (Leave
 * it, Save it in the savings home, or Next month, assigned ahead by next
 * month's own targets), then what the server's dry run says changes. The
 * lines and the rest are the server's, for the choice you made; one Undo
 * takes the whole plan back. "Change amounts" opens the assign sheet.
 */
export function PlanSheet({
	open,
	onClose,
	month,
	amountMinor,
}: SheetProps<{ amountMinor?: number }>) {
	const t = useTranslations("budgetSheets.plan");
	const monthName = useMonthName();
	const [changing, setChanging] = useState(false);
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { undoOf, money } = useBudgetWrite();
	const currency = m.data?.book.currency ?? "";
	const fill = api.envelope.fillFromTargets.useQuery(
		{
			...(m.monthKey ? { month: m.monthKey } : {}),
			...(amountMinor ? { amountMinor } : {}),
		},
		{ enabled: m.data !== null, placeholderData: keepPreviousData },
	);
	const [choice, setChoice] = useState<Choice>("LEAVE");
	const data = fill.data ?? null;
	const input: UsePlan | null = data
		? { rest: choice, ...(amountMinor ? { amountMinor } : {}) }
		: null;
	const preview = api.envelope.usePlanPreview.useMutation();
	const commit = api.envelope.usePlan.useMutation();
	const w = useMoneyWrite({
		input,
		preview: preview.mutateAsync,
		commit: commit.mutateAsync,
		toast: (res) => {
			const given = res.changes.find((c) => c.id === "budget.notPlannedYet");
			const count = res.value.lines.length;
			return given
				? t("toast", {
						amount: money({ minor: Math.abs(given.delta.minor), currency }),
						count,
					})
				: t("toastShort", { count });
		},
		undo: (res) => {
			const batchId = res.value.batchId;
			return batchId ? undoOf({ batchId }) : undefined;
		},
	});

	// The lines are the server's for this choice; before it answers, the fill's own.
	const lines: Line[] = w.dry.preview?.value.lines ?? data?.lines ?? [];
	const groups = useMemo(() => {
		const out = new Map<string, Line[]>();
		for (const l of lines) {
			if (l.amount.minor <= 0) continue;
			const key =
				l.month !== m.monthKey
					? `month:${l.month}`
					: (m.byId.get(l.envelopeId)?.groupName ?? "");
			out.set(key, [...(out.get(key) ?? []), l]);
		}
		return [...out];
	}, [lines, m.byId, m.monthKey]);

	const save = data?.restOptions.find((o) => o.choice === "SAVE") ?? null;
	const next = data?.restOptions.find((o) => o.choice === "NEXT_MONTH") ?? null;
	const saveName = save?.envelopeId
		? (m.byId.get(save.envelopeId)?.name ?? "")
		: "";
	const rest = w.dry.preview?.value.rest ?? data?.rest ?? null;
	const heading = (key: string) =>
		key.startsWith("month:")
			? t("nextMonthGroup", { month: monthName(Number(key.slice(6))) })
			: key || t("noGroup");
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("use")}
			title={t("title")}
		>
			{!data || m.loading ? (
				<SkeletonRows count={4} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">
						{t.rich("lead", {
							amount: () => (
								<Money figure="budget.notPlannedYet" value={data.available} />
							),
						})}
					</p>
					{groups.length === 0 ? (
						<p className="text-fg-3 text-small">{t("met")}</p>
					) : (
						groups.map(([key, group]) => (
							<section aria-label={heading(key)} key={key}>
								<h3 className="text-fg text-small mb-1 font-semibold">
									{heading(key)}
								</h3>
								<RowList variant="flat">
									{group.map((l) => {
										const e = m.byId.get(l.envelopeId);
										return (
											<Row
												end={<Money value={l.amount} />}
												key={`${l.month}-${l.envelopeId}-${l.step}`}
												lead={e ? <EnvelopeTile envelope={e} /> : undefined}
												sub={<RowSub parts={[t(`why.${l.step}`)]} />}
												title={e?.name ?? t("envelopeFallback")}
											/>
										);
									})}
								</RowList>
							</section>
						))
					)}
					{data.rest.minor > 0 ? (
						<section
							aria-label={t("restLabel")}
							className="flex flex-col gap-2"
						>
							<h3 className="text-fg text-small font-semibold">
								{t.rich("restTitle", {
									amount: () => <Money value={data.rest} />,
								})}
							</h3>
							<FilterChips label={t("restLabel")}>
								<FilterChip
									onClick={() => setChoice("LEAVE")}
									selected={choice === "LEAVE"}
								>
									{t("leave")}
								</FilterChip>
								{save?.envelopeId ? (
									<FilterChip
										onClick={() => setChoice("SAVE")}
										selected={choice === "SAVE"}
									>
										{t("saveIt", { name: saveName })}
									</FilterChip>
								) : null}
								{next?.month ? (
									<FilterChip
										onClick={() => setChoice("NEXT_MONTH")}
										selected={choice === "NEXT_MONTH"}
									>
										{t("nextMonth", { month: monthName(next.month) })}
									</FilterChip>
								) : null}
							</FilterChips>
							{choice !== "LEAVE" && rest ? (
								<p className="text-fg-3 text-small">
									{t.rich("restStays", {
										pool,
										amount: () => <Money value={rest} />,
									})}
								</p>
							) : null}
						</section>
					) : null}
					<FigureChanges dry={w.dry} poolName={pool} />
					<div>
						<Button kind="ghost" onClick={() => setChanging(true)} size="sm">
							{t("change")}
						</Button>
					</div>
				</div>
			)}
			{changing ? (
				<AssignSheet
					month={month}
					onClose={() => {
						setChanging(false);
						onClose();
					}}
					open
				/>
			) : null}
		</Sheet>
	);
}
