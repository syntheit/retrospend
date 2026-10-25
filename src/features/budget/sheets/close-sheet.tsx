"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { CarryOverspend } from "./carry-overspend";
import { EnvelopeTile } from "./envelope-tile";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";
import { useBudgetWrite } from "./use-write";

/** The month after `key` (202612 is followed by 202701). */
const nextKey = (key: number) => (key % 100 === 12 ? key + 89 : key + 1);

/**
 * The month summary (SPEC §6.6): what a closed month did, read-only, from the
 * server's stored close. Money in, what was assigned, what went over and
 * where it came out of, what each leftover rule did. Done marks that
 * revision as read. An overspend can be taken from the envelope's own next
 * month instead (its own previewed, undoable step).
 */
export function CloseSheet({
	open,
	onClose,
	month: viewed,
	closedMonth,
}: SheetProps<{ closedMonth: number }>) {
	const t = useTranslations("budgetSheets.close");
	const name = useMonthName();
	const { refresh } = useBudgetWrite();
	const m = useMonth(viewed);
	const pool = usePoolName(m.data);
	const summary = api.envelope.monthSummary.useQuery({ month: closedMonth });
	const ack = api.envelope.acknowledgeMonth.useMutation();
	const [carry, setCarry] = useState<string | null>(null);
	const s = summary.data ?? null;
	const sum = s?.summary ?? null;
	const next = name(nextKey(closedMonth));
	const nameOf = (id: string) => m.byId.get(id)?.name ?? t("envelopeFallback");
	const over = (sum?.envelopes ?? []).filter((e) => e.overspent > 0);
	const left = (sum?.envelopes ?? []).filter(
		(e) => e.returned > 0 || e.swept > 0,
	);
	const money = (minor: number) => ({
		minor,
		currency: sum?.currency ?? "",
	});
	const carrying = over.find((e) => e.id === carry) ?? null;

	const onSubmit = async () => {
		if (s && s.acknowledgedRevision !== s.revision) {
			await ack.mutateAsync({ month: closedMonth, revision: s.revision });
			await refresh();
		}
	};
	return (
		<Sheet
			cancelLabel={t("close")}
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitLabel={t("done")}
			title={t("title", { month: name(closedMonth) })}
		>
			{summary.isLoading || m.loading ? (
				<SkeletonRows count={4} />
			) : !s || !sum ? (
				<p className="text-fg-2 text-small">{t("notClosed")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<RowList label={t("facts")} variant="flat">
						<Row
							end={<Money value={money(sum.moneyIn)} />}
							title={t("moneyIn")}
						/>
						<Row
							end={<Money value={money(sum.assigned)} />}
							title={t("assigned")}
						/>
					</RowList>
					{s.lateEntries ? (
						<p className="text-fg-3 text-small">
							{t("late", { count: s.lateEntries })}
						</p>
					) : null}
					{over.length > 0 ? (
						<section aria-label={t("overTitle")}>
							<h3 className="text-fg text-small mb-1 font-semibold">
								{t("overTitle")}
							</h3>
							<RowList variant="flat">
								{over.map((e) => {
									const env = m.byId.get(e.id);
									return (
										<Row
											end={
												<>
													<Money sign="never" value={money(e.overspent)} />
													<Button
														kind="secondary"
														onClick={() => setCarry(e.id)}
														size="sm"
													>
														{t("takeInstead", { month: next })}
													</Button>
												</>
											}
											key={e.id}
											lead={env ? <EnvelopeTile envelope={env} /> : undefined}
											sub={
												<RowSub parts={[t("cameOut", { pool, month: next })]} />
											}
											title={nameOf(e.id)}
										/>
									);
								})}
							</RowList>
						</section>
					) : null}
					{left.length > 0 ? (
						<section aria-label={t("leftTitle")}>
							<h3 className="text-fg text-small mb-1 font-semibold">
								{t("leftTitle")}
							</h3>
							<RowList variant="flat">
								{left.map((e) => (
									<Row
										end={
											<Money
												value={money(e.returned > 0 ? e.returned : e.swept)}
											/>
										}
										key={e.id}
										sub={
											<RowSub
												parts={[
													e.returned > 0
														? t("returned", { pool })
														: t("swept", {
																name: e.sweepToId ? nameOf(e.sweepToId) : "",
															}),
												]}
											/>
										}
										title={nameOf(e.id)}
									/>
								))}
							</RowList>
						</section>
					) : null}
				</div>
			)}
			{carrying ? (
				<CarryOverspend
					amountMinor={carrying.overspent}
					byId={m.byId}
					envelopeId={carrying.id}
					monthName={next}
					name={nameOf(carrying.id)}
					onClose={() => setCarry(null)}
					open
					poolName={pool}
				/>
			) : null}
		</Sheet>
	);
}
