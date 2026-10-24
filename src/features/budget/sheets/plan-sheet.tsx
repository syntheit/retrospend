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
import { useBudgetSheets } from "./controls";
import { EnvelopeTile } from "./envelope-tile";
import { MovementChanges } from "./movement-changes";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useDryRun } from "./use-dry-run";
import { useMonth } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type AssignInput = RouterInputs["envelope"]["assign"];
type Fill = RouterOutputs["envelope"]["fillFromTargets"];
type Choice = "LEAVE" | "SAVE";

/**
 * The write Use my plan makes: the server's fill lines, plus the rest in the
 * savings home when you chose Save it. One envelope appears once per batch,
 * so a rest that lands on an envelope the plan already funds joins its line.
 */
function itemsOf(fill: Fill, choice: Choice, ids: Map<string, string>) {
	const sums = new Map<string, number>();
	const add = (envelopeId: string, minor: number) =>
		sums.set(envelopeId, (sums.get(envelopeId) ?? 0) + minor);
	for (const l of fill.lines)
		if (l.amount.minor > 0) add(l.envelopeId, l.amount.minor);
	const save = fill.restOptions.find((o) => o.choice === "SAVE");
	if (choice === "SAVE" && save?.envelopeId && fill.rest.minor > 0)
		add(save.envelopeId, fill.rest.minor);
	return [...sums].map(([envelopeId, amountMinor]) => {
		let id = ids.get(envelopeId);
		if (!id) {
			id = newId();
			ids.set(envelopeId, id);
		}
		return { id, envelopeId, amountMinor };
	});
}

/**
 * Use my plan (owner N72, RC-5): money with no job gets its jobs from your
 * targets in one tap. Every line is listed, then where the rest goes (Leave
 * it, or Save it in the savings home), then what the server's dry run says
 * changes. "Change amounts" opens the assign sheet instead. One Undo takes
 * the whole plan back.
 */
export function PlanSheet({
	open,
	onClose,
	month,
	amountMinor,
}: SheetComponentProps<"plan">) {
	const t = useTranslations("budgetSheets.plan");
	const sheets = useBudgetSheets();
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const { refresh, saved, undoOf, money } = useBudgetWrite();
	const currency = m.data?.book.currency ?? "";
	const fill = api.envelope.fillFromTargets.useQuery(
		{
			...(m.monthKey ? { month: m.monthKey } : {}),
			...(amountMinor ? { amountMinor } : {}),
		},
		{ enabled: m.data !== null, placeholderData: keepPreviousData },
	);
	const [choice, setChoice] = useState<Choice>("LEAVE");
	const [batchId] = useState(newId);
	const ids = useState(() => new Map<string, string>())[0];
	const data = fill.data ?? null;

	const input: AssignInput | null = useMemo(() => {
		if (!data || !m.monthKey) return null;
		const items = itemsOf(data, choice, ids);
		return items.length
			? { batchId, month: m.monthKey, mode: "add", items }
			: null;
	}, [data, choice, m.monthKey, batchId, ids]);

	const previewMutation = api.envelope.assignPreview.useMutation();
	const commit = api.envelope.assign.useMutation();
	const dry = useDryRun(previewMutation.mutateAsync, input);

	const groups = useMemo(() => {
		const out = new Map<string, Fill["lines"]>();
		for (const l of data?.lines ?? []) {
			if (l.amount.minor <= 0) continue;
			const g = m.byId.get(l.envelopeId)?.groupName ?? "";
			out.set(g, [...(out.get(g) ?? []), l]);
		}
		return [...out];
	}, [data, m.byId]);

	const save = data?.restOptions.find((o) => o.choice === "SAVE") ?? null;
	const saveName = save?.envelopeId
		? (m.byId.get(save.envelopeId)?.name ?? "")
		: "";

	const onSubmit = async () => {
		if (!input) return false;
		const res = await commit.mutateAsync(input);
		await refresh();
		const given = res.changes.find((c) => c.id === "budget.notPlannedYet");
		saved(
			given
				? t("toast", {
						amount: money({ minor: Math.abs(given.delta.minor), currency }),
						count: input.items.length,
					})
				: t("toastShort", { count: input.items.length }),
			undoOf({ batchId: input.batchId }),
		);
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={dry.status !== "ready"}
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
						groups.map(([group, lines]) => (
							<section aria-label={group || t("noGroup")} key={group}>
								<h3 className="text-fg text-small mb-1 font-semibold">
									{group || t("noGroup")}
								</h3>
								<RowList variant="flat">
									{lines.map((l) => {
										const e = m.byId.get(l.envelopeId);
										return (
											<Row
												end={<Money value={l.amount} />}
												key={l.envelopeId}
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
							</FilterChips>
						</section>
					) : null}
					<MovementChanges
						byId={m.byId}
						dry={dry}
						fallbackName={t("envelopeFallback")}
						poolName={pool}
					/>
					<div>
						<Button
							kind="ghost"
							onClick={() => {
								onClose();
								sheets.open("assign");
							}}
							size="sm"
						>
							{t("change")}
						</Button>
					</div>
				</div>
			)}
		</Sheet>
	);
}
