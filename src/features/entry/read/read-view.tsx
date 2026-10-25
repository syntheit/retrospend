"use client";

import { toMinorUnits } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import type { RouterOutputs } from "~/trpc/react";

export type Tx = RouterOutputs["sharedTransaction"]["getById"];

/** The one line above the details, or nothing: what needs the person comes first. */
export type ReadNotice = {
	tone: "info" | "attention";
	text: string;
	/** A lock glyph leads the line (settled). */
	lock?: boolean;
};

/**
 * A shared expense as a read view (owner Q1, RC11): amount and rate, paid by,
 * your share, category, date, project and state. What you may do about it is
 * the footer's `actions`, which the host decides from the corrections router
 * (Ask to fix, Respond, Correct, Cancel request).
 */
export function ReadView({
	tx,
	failed,
	onClose,
	notice,
	quote,
	actions,
	me,
}: {
	tx: Tx | null;
	failed: boolean;
	onClose: () => void;
	notice: ReadNotice | null;
	/** Someone's words on the request (a reply), shown under the line. */
	quote: { name: string; imageUrl: string | null; text: string } | null;
	actions: ReactNode;
	me: string | undefined;
}) {
	const t = useTranslations("entry.read");
	const { label } = useDateFormat();
	const mine = tx?.splitParticipants.find(
		(p) => p.participantType === "user" && p.participantId === me,
	);
	const money = (n: number) => ({
		minor: toMinorUnits(n, tx?.currency ?? "USD"),
		currency: tx?.currency ?? "USD",
	});
	return (
		<Sheet
			detent="medium"
			footer={
				<>
					<Button kind="secondary" onClick={onClose}>
						{t("close")}
					</Button>
					{actions}
				</>
			}
			onOpenChange={(o) => !o && onClose()}
			open
			title={tx?.description ?? t("amount")}
		>
			{!tx ? (
				failed ? (
					<p className="text-danger text-small" role="alert">
						{t("notAvailable")}
					</p>
				) : (
					<Skeleton className="h-40 w-full" />
				)
			) : (
				<div className="flex flex-col gap-1" data-entry-read="">
					{notice ? (
						<Notice tone={notice.tone}>
							{notice.lock ? (
								<span className="inline-flex items-center gap-2">
									<Lock aria-hidden="true" className="size-4" />
									{notice.text}
								</span>
							) : (
								notice.text
							)}
						</Notice>
					) : null}
					{quote ? (
						<div className="flex items-start gap-3 py-2">
							<Face imageUrl={quote.imageUrl} name={quote.name} size="xs" />
							<p className="text-fg-2 text-small min-w-0 flex-1">
								{quote.text}
							</p>
						</div>
					) : null}
					<Row k={t("amount")}>
						<Money
							figure={`entry.amount:shared:${tx.id}`}
							value={money(tx.amount)}
						/>
					</Row>
					<Row k={t("paidBy")}>
						<Face
							imageUrl={tx.paidBy.avatarUrl}
							name={tx.paidBy.name}
							size="xs"
						/>
						{tx.paidBy.name}
					</Row>
					{mine ? (
						<Row k={t("yourShare")}>
							<Money
								figure={`entry.share:shared:${tx.id}`}
								value={money(mine.shareAmount)}
							/>
						</Row>
					) : null}
					{tx.category ? <Row k={t("category")}>{tx.category.name}</Row> : null}
					<Row k={t("date")}>{label.long(dayKey(new Date(tx.date)))}</Row>
					{tx.projectName ? <Row k={t("project")}>{tx.projectName}</Row> : null}
					{mine ? (
						<Row k={t("state")}>{t(`states.${mine.verificationStatus}`)}</Row>
					) : null}
				</div>
			)}
		</Sheet>
	);
}

function Row({ k, children }: { k: string; children: ReactNode }) {
	return (
		<div className="min-h-ctl border-line flex items-center justify-between gap-3 border-b">
			<span className="text-fg-2 text-small">{k}</span>
			<span className="text-body text-fg flex items-center gap-2 text-right font-medium">
				{children}
			</span>
		</div>
	);
}
