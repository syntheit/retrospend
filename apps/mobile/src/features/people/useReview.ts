import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { PaymentPreview } from "@/features/settle/plan";

export type ReviewChoice = "accept" | "reject" | "fix";

export interface Answered {
	/** Takes the answer back (valid for 24 hours, once). */
	undoToken: string;
}

/**
 * Answering a split somebody added you to: the server's dry run of the
 * answer you picked (accept, reject or ask the person to fix it), and the
 * write itself, keyed by one id per distinct request so a retry replays. The
 * preview is kept with the choice it answered; a preview of another choice
 * is never shown and never recorded.
 */
export function useReview(
	expenseId: string,
	choice: ReviewChoice,
	message: string,
	active: boolean,
) {
	const { api } = useSession();
	const [settled, setSettled] = useState<{
		choice: ReviewChoice;
		preview: PaymentPreview | null;
		failed: boolean;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const write = useRef({ body: "", id: newClientId() });

	// Each opening starts clean, with a fresh write id.
	useEffect(() => {
		if (!active) return;
		setSettled(null);
		setFailed(false);
		write.current = { body: "", id: newClientId() };
	}, [active]);

	const body = JSON.stringify({
		choice,
		message: choice === "fix" ? message : "",
	});
	if (write.current.body !== body) write.current = { body, id: newClientId() };

	// The message does not change any figure, so the dry run follows the choice only.
	useEffect(() => {
		if (!api || !active) return;
		let cancelled = false;
		const shared = api["shared-expenses"];
		const run =
			choice === "accept"
				? shared.previewAccept({ id: expenseId })
				: choice === "reject"
					? shared.previewReject({ id: expenseId })
					: api.corrections.previewAskToFix({ id: expenseId });
		run
			.then((preview) => {
				if (!cancelled) setSettled({ choice, preview, failed: false });
			})
			.catch(() => {
				if (!cancelled) setSettled({ choice, preview: null, failed: true });
			});
		return () => {
			cancelled = true;
		};
	}, [api, active, choice, expenseId]);

	const current = settled && settled.choice === choice ? settled : null;
	const preview = current?.preview ?? null;

	const send = useCallback(async (): Promise<Answered | null> => {
		if (!api || busy || !preview) return null;
		setBusy(true);
		setFailed(false);
		const context = { idempotencyKey: write.current.id };
		try {
			const shared = api["shared-expenses"];
			if (choice === "accept") {
				const done = await shared.accept({ id: expenseId }, { context });
				return { undoToken: done.undo };
			}
			if (choice === "reject") {
				const done = await shared.reject({ id: expenseId }, { context });
				return { undoToken: done.undo };
			}
			const done = await api.corrections.askToFix(
				{
					id: expenseId,
					requestId: write.current.id,
					message: message.trim() === "" ? undefined : message,
				},
				{ context },
			);
			return { undoToken: done.undo };
		} catch {
			setFailed(true);
			return null;
		} finally {
			setBusy(false);
		}
	}, [api, busy, preview, choice, expenseId, message]);

	const undo = useCallback(
		async (token: string): Promise<boolean> => {
			if (!api) return false;
			const options = { context: { idempotencyKey: newClientId() } };
			try {
				if (choice === "fix") await api.corrections.undo({ token }, options);
				else await api["shared-expenses"].undo({ token }, options);
				return true;
			} catch {
				return false;
			}
		},
		[api, choice],
	);

	return {
		preview,
		previewFailed: current?.failed === true,
		busy,
		failed,
		send,
		undo,
	};
}
