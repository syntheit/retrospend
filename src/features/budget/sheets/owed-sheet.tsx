"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { SettleSheet } from "~/features/settle/settle-sheet";
import { api } from "~/trpc/react";
import { ForgiveSheet } from "./forgive-sheet";
import type { SheetProps } from "./types";

type Participant = { type: "user" | "guest" | "shadow"; id: string };

/**
 * Owed to you (SPEC §6.9): per person, what the budget holds for them (it
 * is out of To assign until they pay or you forgive), how long it has been
 * owed and what waits for your OK. Settle up opens the one Settle up sheet
 * and Forgive its own sheet, both nested: Cancel returns here.
 */
export function OwedSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.owed");
	const owed = api.envelope.owed.useQuery();
	const people = api.people.overview.useQuery();
	const [settling, setSettling] = useState<Participant | null>(null);
	const [forgiving, setForgiving] = useState<Participant | null>(null);
	const o = owed.data ?? null;
	const identity =
		people.data?.people.find(
			(p) =>
				settling &&
				p.person.type === settling.type &&
				p.person.id === settling.id,
		)?.person ?? null;
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
												<Button
													kind="secondary"
													onClick={() => setSettling(p.participant)}
													size="sm"
												>
													{t("settle")}
												</Button>
											)}
											<Button
												kind="ghost"
												onClick={() => setForgiving(p.participant)}
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
			<SettleSheet onClose={() => setSettling(null)} person={identity} />
			{forgiving ? (
				<ForgiveSheet
					month={month}
					onClose={() => setForgiving(null)}
					open
					participant={forgiving}
				/>
			) : null}
		</Sheet>
	);
}
