"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { api } from "~/trpc/react";
import { usePoolName } from "./pool";
import { RuleApply } from "./rule-apply";
import { RuleEditor } from "./rule-editor";
import { type Rule, useRuleSentence } from "./rule-sentence";
import type { SheetProps } from "./types";
import { useMonth } from "./use-month";

/**
 * Income rules (SPEC §5.10, §6.10): what happens when money arrives, in the
 * order the rules run. Each is one sentence you can pause, move or remove
 * (its ⋯ menu is the action registry's incomeRule entity); pausing, moving or
 * removing never touches money already assigned. A rule can also be applied
 * once to this month's money in (previewed first).
 */
export function RulesSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.rules");
	const sentence = useRuleSentence();
	const utils = api.useUtils();
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const rules = api.envelope.rules.useQuery();
	const update = api.envelope.updateRule.useMutation();
	const reorder = api.envelope.reorderRules.useMutation();
	const archive = api.envelope.archiveRule.useMutation();
	const [adding, setAdding] = useState(false);
	const [applying, setApplying] = useState<Rule | null>(null);
	const list = rules.data ?? [];
	const name = (id: string) => m.byId.get(id)?.name ?? t("envelopeFallback");
	const refresh = () => utils.envelope.rules.invalidate();

	const move = async (index: number, by: -1 | 1) => {
		const ids = list.map((r) => r.id);
		const [id] = ids.splice(index, 1);
		if (!id) return;
		ids.splice(index + by, 0, id);
		await reorder.mutateAsync({ ids });
		await refresh();
	};

	return (
		<Sheet
			cancelLabel={t("done")}
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title")}
		>
			{rules.isLoading || m.loading ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<p className="text-fg-2 text-small">{t("lead")}</p>
					{list.length === 0 ? (
						<p className="text-fg-3 text-small">{t("none")}</p>
					) : (
						<RowList label={t("title")} variant="flat">
							{list.map((r, i) => (
								<Row
									actions={
										<ActionMenu
											entity="incomeRule"
											handlers={{
												moveUp: () => move(i, -1),
												moveDown: () => move(i, 1),
												applyToMonth: () => setApplying(r),
												remove: () =>
													archive.mutateAsync({ id: r.id }).then(refresh),
											}}
											target={{
												id: r.id,
												name: r.name,
												first: i === 0,
												last: i === list.length - 1,
												active: r.active,
											}}
										/>
									}
									end={
										<Switch
											aria-label={t("active", { name: r.name })}
											checked={r.active}
											onCheckedChange={(active) =>
												void update
													.mutateAsync({ id: r.id, active })
													.then(refresh)
											}
										/>
									}
									key={r.id}
									sub={
										<RowSub
											parts={[
												sentence(r, name(r.envelopeId)),
												r.active ? null : t("paused"),
											]}
										/>
									}
									title={r.name}
								/>
							))}
						</RowList>
					)}
					<div>
						<Button kind="secondary" onClick={() => setAdding(true)}>
							{t("add")}
						</Button>
					</div>
				</div>
			)}
			{adding ? (
				<RuleEditor
					currency={m.data?.book.currency ?? ""}
					envelopes={m.envelopes}
					onClose={() => setAdding(false)}
					open
				/>
			) : null}
			{applying ? (
				<RuleApply
					byId={m.byId}
					onClose={() => setApplying(null)}
					open
					poolName={pool}
					ruleId={applying.id}
					ruleName={applying.name}
				/>
			) : null}
		</Sheet>
	);
}
