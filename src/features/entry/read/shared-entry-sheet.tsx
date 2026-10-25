"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { AskToFixSheet } from "~/features/corrections/ask-to-fix-sheet";
import { CorrectSheet } from "~/features/corrections/correct-sheet";
import { RespondToFixSheet } from "~/features/corrections/respond-to-fix-sheet";
import {
	isOpenRequest,
	useFixState,
} from "~/features/corrections/use-fix-state";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { ExpenseSheet } from "../expense/expense-sheet";
import { type ReadNotice, ReadView, type Tx } from "./read-view";

type View = "read" | "ask" | "respond" | "correct" | "edit";

const first = (name: string | undefined) => name?.split(" ")[0] ?? "";

/**
 * A shared expense from a row: you edit what you may edit (the sheet), and
 * anything else opens as a read view (owner Q1, RC11) with the actions the
 * corrections router allows: Ask to fix on someone else's split, Correct on
 * a settled one you added, Respond when you were asked to fix it, Cancel
 * request when you asked.
 */
export function SharedEntrySheet({
	id,
	onClose,
}: {
	id: string;
	onClose: () => void;
}) {
	const t = useTranslations("corrections.read");
	const tr = useTranslations("entry.read");
	const toast = useToast();
	const { label } = useDateFormat();
	const { data: session } = useSession();
	const me = session?.user?.id;
	const tx = api.sharedTransaction.getById.useQuery({ id });
	const author = api.entry.sharedAuthor.useQuery({ id });
	const fix = useFixState(id, me);
	const [view, setView] = useState<View>("read");
	const cancel = api.corrections.cancelFix.save.useMutation();
	const restore = api.corrections.restoreFix.save.useMutation();
	const data: Tx | null = tx.data ?? null;
	const lock = fix.lock;
	const { asked, sent } = fix;

	const ready = data !== null && !fix.loading;
	if (ready) {
		if (view === "edit" || (view === "read" && data.canEdit && !asked))
			return (
				<ExpenseSheet
					onClose={onClose}
					onOpen={() => onClose()}
					request={{ kind: "expense", mode: "editShared", id }}
				/>
			);
		if (view === "correct")
			return (
				<CorrectSheet id={id} onBack={() => setView("read")} onDone={onClose} />
			);
	}

	const person = (ref: { type: string; id: string } | undefined) => {
		if (!data || !ref) return undefined;
		return [data.paidBy, ...data.splitParticipants].find(
			(p) => p.participantType === ref.type && p.participantId === ref.id,
		);
	};
	const creator = first(author.data?.name);
	const asker = person(asked?.requestedBy);
	const askerName = first(asker?.name);

	if (ready && view === "ask" && lock?.canAskToFix)
		return (
			<AskToFixSheet
				locked={lock.locked}
				name={creator}
				onBack={() => setView("read")}
				onDone={onClose}
				title={data?.description ?? ""}
				transactionId={id}
			/>
		);
	if (ready && view === "respond" && asked)
		return (
			<RespondToFixSheet
				asker={{
					name: askerName,
					fullName: asker?.name ?? askerName,
					imageUrl: asker?.avatarUrl ?? null,
				}}
				onAccepted={() => setView(lock?.canCorrect ? "correct" : "edit")}
				onBack={() => setView("read")}
				onDone={onClose}
				request={asked}
			/>
		);

	const cancelRequest = async () => {
		if (!sent) return;
		try {
			const r = await cancel.mutateAsync({ id: sent.id });
			toast.saved(t("canceled", { name: creator }), {
				undo: () =>
					restore.mutateAsync({
						id: sent.id,
						status:
							r.value.previousStatus === "ACCEPTED" ? "ACCEPTED" : "PENDING",
					}),
			});
		} catch (e) {
			toast.failed(e instanceof Error ? e.message : t("failed"));
		}
	};

	const day = (iso: string) => label.short(dayKey(new Date(iso)));
	const sentOpen = sent && isOpenRequest(sent);
	let notice: ReadNotice | null = null;
	if (asked) {
		notice = {
			tone: "attention",
			text:
				asked.status === "PENDING"
					? t("askedPending", { name: askerName })
					: t(lock?.canCorrect ? "askedAcceptedCorrect" : "askedAcceptedEdit", {
							name: askerName,
						}),
		};
	} else if (sent && sent.status !== "CANCELLED") {
		notice = {
			tone: "info",
			text: t(`sent.${sent.status}`, {
				name: creator,
				date: day(sent.createdAt),
			}),
		};
	} else if (data?.isLocked) {
		notice = { tone: "info", text: tr("locked"), lock: true };
	} else if (author.data && !author.data.you) {
		const waiting = data?.splitParticipants.find(
			(p) => p.participantType === "user" && p.participantId === me,
		)?.verificationStatus;
		notice = {
			tone: "info",
			text: tr(waiting === "PENDING" ? "addedReview" : "added", {
				name: creator,
			}),
		};
	}

	const go = (
		v: View,
		text: string,
		kind: "primary" | "secondary" = "primary",
	) => (
		<Button kind={kind} onClick={() => setView(v)}>
			{text}
		</Button>
	);
	let actions: React.ReactNode = null;
	if (asked)
		actions =
			asked.status === "PENDING"
				? go("respond", t("respond"))
				: lock?.canCorrect
					? go("correct", tr("correct"))
					: data?.canEdit
						? go("edit", t("edit"))
						: null;
	else if (sentOpen)
		actions = (
			<Button
				kind="secondary"
				loading={cancel.isPending}
				onClick={() => void cancelRequest()}
			>
				{t("cancel")}
			</Button>
		);
	else if (lock?.canCorrect) actions = go("correct", tr("correct"));
	else if (lock?.canAskToFix) actions = go("ask", tr("ask", { name: creator }));

	const reply =
		sent?.status === "DECLINED" && sent.reply
			? {
					name: person(sent.asked)?.name ?? creator,
					imageUrl: person(sent.asked)?.avatarUrl ?? null,
					text: sent.reply,
				}
			: null;

	return (
		<ReadView
			actions={actions}
			failed={tx.isError}
			me={me}
			notice={notice}
			onClose={onClose}
			quote={reply}
			tx={ready ? data : null}
		/>
	);
}
