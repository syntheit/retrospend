"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { useBudgetSheets } from "./controls";
import type { SheetComponentProps } from "./types";

/**
 * Owed to you (SPEC §6.9): per person, what the budget holds for them (it
 * is out of To assign until they pay or you forgive), how long it has been
 * owed and what waits for your OK. Settle up opens the person's page, where
 * the one Settle up sheet lives; Forgive opens its own sheet.
 */
export function OwedSheet({ open, onClose }: SheetComponentProps<"owed">) {
	const t = useTranslations("budgetSheets.owed");
	const sheets = useBudgetSheets();
	const owed = api.envelope.owed.useQuery();
	const o = owed.data ?? null;
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="medium"
			onOpenChange={(v) => !v && onClose()}
			open={open}
			title={t("title")}
		>
			{!o ? (
				<SkeletonRows count={3} />
			) : o.people.length === 0 ? (
				<p className="text-fg-2 text-small">{t("nobody")}</p>
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<div className="flex items-baseline justify-between gap-3">
						<span className="text-fg-2 text-small">{t("held")}</span>
						<Money figure="budget.heldForOthers" value={o.held} />
					</div>
					<RowList label={t("people")} variant="flat">
						{o.people.map((p) => (
							<Row
								end={
									<>
										<Money value={p.held} />
										<span className="flex gap-2">
											{p.participant.type === "guest" ? null : (
												<Button asChild kind="secondary" size="sm">
													<Link
														href={`/people/${p.participant.type}/${p.participant.id}`}
														onClick={onClose}
													>
														{t("settle")}
													</Link>
												</Button>
											)}
											<Button
												kind="ghost"
												onClick={() => {
													onClose();
													sheets.open("forgive", {
														participant: p.participant,
													});
												}}
												size="sm"
											>
												{t("forgive")}
											</Button>
										</span>
									</>
								}
								key={`${p.participant.type}-${p.participant.id}`}
								lead={<Face name={p.name ?? ""} />}
								sub={
									<RowSub
										parts={[
											p.ageDays !== null ? t("age", { days: p.ageDays }) : null,
											p.pending.minor > 0 ? (
												<span key="pending">
													{t.rich("pending", {
														amount: () => <Money value={p.pending} />,
													})}
												</span>
											) : null,
										]}
									/>
								}
								title={p.name ?? t("someone")}
							/>
						))}
					</RowList>
					{o.incomplete ? (
						<p className="text-fg-3 text-small">{t("incomplete")}</p>
					) : null}
				</div>
			)}
		</Sheet>
	);
}
