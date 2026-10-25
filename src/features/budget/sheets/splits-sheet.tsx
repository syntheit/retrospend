"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Face } from "~/components/ui/avatar-face";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { firstName } from "~/features/people/filter";
import { ReviewSheet } from "~/features/people/review-sheet";
import type { NeedsItemDTO } from "~/features/people/types";
import { api } from "~/trpc/react";
import type { SheetProps } from "./types";
import { UnroutedShares } from "./unrouted-shares";

type Verify = Extract<NeedsItemDTO, { kind: "verify" }>;

/**
 * Splits waiting for your OK: shares someone else added you to. Each opens
 * People's review sheet (Accept or Reject), the one place that decides it;
 * until you answer, the share counts as pending in the budget (D20). Below,
 * the shares that found no category of yours, each to pick an envelope for.
 */
export function SplitsSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.splits");
	const people = api.people.overview.useQuery();
	const unrouted = api.envelope.unroutedShares.useQuery({});
	const [review, setReview] = useState<Verify | null>(null);
	const waiting = (people.data?.needs ?? []).filter(
		(n): n is Verify => n.kind === "verify",
	);
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title")}
		>
			{people.isLoading ? (
				<SkeletonRows count={3} />
			) : waiting.length === 0 && (unrouted.data?.count ?? 0) === 0 ? (
				<p className="text-fg-2 text-small">{t("none")}</p>
			) : waiting.length === 0 ? null : (
				<RowList label={t("title")} variant="flat">
					{waiting.map((n) => (
						<Row
							end={<Money value={n.amount} />}
							key={n.id}
							lead={<Face name={n.person.name} />}
							open={{ onOpen: () => setReview(n), label: n.title }}
							sub={
								<RowSub
									parts={[t("addedBy", { name: firstName(n.person.name) })]}
								/>
							}
							title={n.title}
						/>
					))}
				</RowList>
			)}
			<div className="mt-4">
				<UnroutedShares month={month} />
			</div>
			<ReviewSheet item={review} onClose={() => setReview(null)} />
		</Sheet>
	);
}
