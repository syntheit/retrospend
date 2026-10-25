"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import type { FixRequestDto } from "~/lib/schemas/corrections";
import { api } from "~/trpc/react";
import { ChangesBlock } from "../entry/changes";
import { Field } from "../entry/shared-ui";
import { NO_MONEY } from "./no-money";
import { usePreview } from "./use-preview";

/**
 * The person asked to fix a split answers (MONEY-MOVES 1.11). Accept moves
 * on to the fix (Correct for a settled split, Edit for an open one) and a
 * correction or an edit then marks the request fixed. Decline tells the
 * asker, with a reply if you write one, and its toast offers Undo. Neither
 * moves money; the dry run says so.
 */
export function RespondToFixSheet({
	request,
	asker,
	onBack,
	onAccepted,
	onDone,
}: {
	request: FixRequestDto;
	/** Who asked: their first name for the sentences and the face. */
	asker: { name: string; fullName: string; imageUrl: string | null };
	onBack: () => void;
	onAccepted: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("corrections.respond");
	const toast = useToast();
	const [reply, setReply] = useState("");
	const [error, setError] = useState<string | null>(null);
	const preview = api.corrections.respondToFix.preview.useMutation();
	const respond = api.corrections.respondToFix.save.useMutation();
	const restore = api.corrections.restoreFix.save.useMutation();
	const answer = (response: "accept" | "decline") => ({
		id: request.id,
		response,
		...(reply.trim() ? { reply: reply.trim() } : {}),
	});
	const dry = usePreview(
		(i) => preview.mutateAsync(i),
		request.status === "PENDING" ? answer("accept") : null,
	);

	const send = async (response: "accept" | "decline") => {
		setError(null);
		try {
			await respond.mutateAsync(answer(response));
		} catch (e) {
			setError(e instanceof Error ? e.message : t("failed"));
			return;
		}
		if (response === "accept") return onAccepted();
		toast.saved(t("declined", { name: asker.name }), {
			undo: () => restore.mutateAsync({ id: request.id, status: "PENDING" }),
		});
		onDone();
	};

	return (
		<Sheet
			detent="medium"
			footer={
				<>
					<Button kind="ghost" onClick={onBack}>
						{t("back")}
					</Button>
					<span className="flex-1" />
					<Button
						kind="secondary"
						loading={respond.isPending}
						onClick={() => void send("decline")}
					>
						{t("decline")}
					</Button>
					<Button
						data-sheet-submit=""
						kind="primary"
						loading={respond.isPending}
						onClick={() => void send("accept")}
					>
						{t("accept")}
					</Button>
				</>
			}
			onOpenChange={(o) => !o && onBack()}
			open
			title={t("title", { name: asker.name })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<div className="flex items-start gap-3">
					<Face imageUrl={asker.imageUrl} name={asker.fullName} size="sm" />
					<p className="text-body min-w-0 flex-1">
						{request.message ? request.message : t("noMessage")}
					</p>
				</div>
				<Field htmlFor="fix-reply" label={t("reply")}>
					<Textarea
						autoComplete="off"
						id="fix-reply"
						maxLength={1000}
						onChange={(e) => setReply(e.target.value)}
						placeholder={t("replyPlaceholder")}
						rows={2}
						value={reply}
					/>
				</Field>
				<p className="text-fg-3 text-meta">{t("hint", { name: asker.name })}</p>
				<ChangesBlock
					byDesign={NO_MONEY}
					cannot={dry.error}
					diff={dry.data}
					empty={t("empty")}
					loading={dry.loading}
				/>
				{error ? (
					<p className="text-danger text-small" role="alert">
						{error}
					</p>
				) : null}
			</div>
		</Sheet>
	);
}
