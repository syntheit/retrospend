"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Tip } from "~/components/ui/tooltip";
import { useSession } from "~/hooks/use-session";
import { toMinorUnits } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import { api, type RouterOutputs } from "~/trpc/react";
import { ExpenseSheet } from "../expense/expense-sheet";
import { ENTRY_SEAMS } from "./seams";

/**
 * A shared expense from a row: you edit what you may edit (the sheet), and
 * anything else opens as a read view (owner Q1, RC11): amount and rate,
 * paid by, your share, category, date, project and state, with Ask to fix,
 * or Correct on a settled one you added.
 */
export function SharedEntrySheet({
	id,
	onClose,
}: {
	id: string;
	onClose: () => void;
}) {
	const tx = api.sharedTransaction.getById.useQuery({ id });
	if (tx.data?.canEdit) {
		return (
			<ExpenseSheet
				onClose={onClose}
				onOpen={() => onClose()}
				request={{ kind: "expense", mode: "editShared", id }}
			/>
		);
	}
	return (
		<ReadView
			id={id}
			onClose={onClose}
			tx={tx.data ?? null}
			failed={tx.isError}
		/>
	);
}

type Tx = RouterOutputs["sharedTransaction"]["getById"];

function ReadView({
	id,
	tx,
	onClose,
	failed,
}: {
	id: string;
	tx: Tx | null;
	onClose: () => void;
	failed: boolean;
}) {
	const t = useTranslations("entry.read");
	const { label } = useDateFormat();
	const { data: session } = useSession();
	const author = api.entry.sharedAuthor.useQuery({ id });
	const me = session?.user?.id;
	const mine = tx?.splitParticipants.find(
		(p) => p.participantType === "user" && p.participantId === me,
	);
	const name = author.data?.name.split(" ")[0] ?? "";
	const money = (n: number) => ({
		minor: toMinorUnits(n, tx?.currency ?? "USD"),
		currency: tx?.currency ?? "USD",
	});
	// Until the server has the ask state and corrections, the action shows, disabled, and says why.
	const action = (text: string, seam: { available: boolean }) =>
		seam.available ? null : (
			<Tip content={t("notAvailable")}>
				<Button
					aria-disabled="true"
					className="cursor-not-allowed opacity-45"
					kind="primary"
				>
					{text}
				</Button>
			</Tip>
		);
	return (
		<Sheet
			detent="medium"
			footer={
				<>
					<Button kind="secondary" onClick={onClose}>
						{t("close")}
					</Button>
					{tx?.isLocked && author.data?.you
						? action(t("correct"), ENTRY_SEAMS.correct)
						: author.data && !author.data.you
							? action(t("ask", { name }), ENTRY_SEAMS.askToFix)
							: null}
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
					{tx.isLocked ? (
						<Notice>
							<span className="inline-flex items-center gap-2">
								<Lock aria-hidden="true" className="size-4" />
								{t("locked")}
							</span>
						</Notice>
					) : author.data && !author.data.you ? (
						<Notice>
							{mine?.verificationStatus === "PENDING"
								? t("addedReview", { name })
								: t("added", { name })}
						</Notice>
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

function Row({ k, children }: { k: string; children: React.ReactNode }) {
	return (
		<div className="flex min-h-ctl items-center justify-between gap-3 border-line border-b">
			<span className="text-fg-2 text-small">{k}</span>
			<span className="flex items-center gap-2 text-right font-medium text-body text-fg">
				{children}
			</span>
		</div>
	);
}
