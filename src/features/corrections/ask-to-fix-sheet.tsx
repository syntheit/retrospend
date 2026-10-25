"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";
import { ChangesBlock } from "../entry/changes";
import { Field } from "../entry/shared-ui";
import { NO_MONEY } from "./no-money";
import { usePreview } from "./use-preview";

/**
 * Ask to fix (MONEY-MOVES 1.11): a person on a split asks the person who
 * added it to fix it. The sheet says what you are asking, shows the
 * server's dry run of the request (it moves no money, and says so), and
 * Send ends with an Undo toast that takes the request back while nobody
 * has answered. Cancel returns to the read view it came from.
 */
export function AskToFixSheet({
	transactionId,
	title,
	name,
	locked,
	onBack,
	onDone,
}: {
	transactionId: string;
	/** The expense's title, for the toast. */
	title: string;
	/** Their first name. */
	name: string;
	/** A payment settled it: only the difference reopens the balance. */
	locked: boolean;
	onBack: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("corrections.ask");
	const toast = useToast();
	// One id per sheet: a retry or a double click writes one request.
	const [id] = useState(generateId);
	const [message, setMessage] = useState("");
	const preview = api.corrections.askToFix.preview.useMutation();
	const send = api.corrections.askToFix.save.useMutation();
	const withdraw = api.corrections.withdrawFix.save.useMutation();
	const input = {
		id,
		transactionId,
		...(message.trim() ? { message: message.trim() } : {}),
	};
	const dry = usePreview((i) => preview.mutateAsync(i), input);

	const submit = async () => {
		await send.mutateAsync(input);
		toast.saved(t("sent", { name, title }), {
			undo: () => withdraw.mutateAsync({ id }),
		});
		onDone();
		return false;
	};

	return (
		<Sheet
			detent="medium"
			onOpenChange={(o) => !o && onBack()}
			onSubmit={submit}
			open
			submitDisabled={!dry.fresh}
			submitLabel={t("send", { name })}
			title={t("title", { name })}
		>
			<div className="flex flex-col gap-4 pb-4">
				<Field htmlFor="fix-message" label={t("what")}>
					<Textarea
						autoComplete="off"
						id="fix-message"
						maxLength={1000}
						onChange={(e) => setMessage(e.target.value)}
						placeholder={t("placeholder")}
						rows={3}
						value={message}
					/>
				</Field>
				<p className="text-fg-3 text-meta">
					{t(locked ? "hintLocked" : "hintOpen", { name })}
				</p>
				<ChangesBlock
					byDesign={NO_MONEY}
					cannot={dry.error}
					diff={dry.data}
					empty={t("empty")}
					loading={dry.loading}
				/>
			</div>
		</Sheet>
	);
}
