"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "~/components/ui/toast";
import { usePreview } from "~/features/corrections/use-preview";
import { api } from "~/trpc/react";
import {
	answerInput,
	failureSentence,
	reasonOf,
	undoTokenOf,
} from "./review-answer";

/**
 * Answering your own share (R30, R15): the server's dry run of the answer a
 * tap would save, the save, and an Undo toast when it changed something.
 * The dry run is for Accept, or for Reject once `rejecting`; the reason moves
 * no figure, so typing it does not run it again.
 */
export function useShareAnswer({
	item,
	rejecting,
	reason,
	onDone,
}: {
	item: { id: string; title: string } | null;
	rejecting: boolean;
	reason: string;
	onDone: () => void;
}) {
	const t = useTranslations("peoplePage.review");
	const toast = useToast();
	const router = useRouter();
	const preview = api.verification.answer.preview.useMutation();
	const save = api.verification.answer.save.useMutation();
	const restore = api.verification.restoreAnswer.save.useMutation();

	const dry = usePreview(
		// The sheet shows a refusal as a sentence, never the server's text.
		(input: ReturnType<typeof answerInput>) =>
			preview.mutateAsync(input).catch((e: unknown) => {
				throw new Error(
					failureSentence(e, (code) => t(`refused.${code}`), t("failed")),
				);
			}),
		item ? answerInput(item.id, rejecting) : null,
	);

	const send = async () => {
		if (!item) return;
		const input = answerInput(item.id, rejecting);
		try {
			const done = await save.mutateAsync({
				...input,
				reason: rejecting ? reasonOf(reason) : undefined,
			});
			const token = undoTokenOf(done.value);
			router.refresh();
			const message = t(rejecting ? "rejected" : "accepted", {
				title: item.title,
			});
			toast.saved(
				message,
				token
					? {
							undo: async () => {
								await restore.mutateAsync({ restore: token });
								router.refresh();
							},
						}
					: undefined,
			);
			onDone();
		} catch (e) {
			toast.failed(
				failureSentence(e, (code) => t(`refused.${code}`), t("failed")),
			);
		}
	};

	return { dry, send, saving: save.isPending };
}
