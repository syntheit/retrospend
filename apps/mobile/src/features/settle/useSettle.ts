import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { PersonRef, SettleContext } from "@/features/people/source";
import {
	type AmountChoice,
	type Direction,
	type PaymentPreview,
	recordInput,
} from "./plan";

export interface Recorded {
	/** PROPOSED waits for the other person to confirm. */
	status: "PROPOSED" | "FINALIZED";
	undoToken: string;
}

export type SettleStatus = "loading" | "ready" | "loadError";

/**
 * The Settle up flow's state: what is owed (GET /people/{type}/{id}/settle),
 * the preview of the exact write (POST /payments/preview), and the record
 * (POST /payments) keyed by one id per sheet opening, so a retry after a
 * dropped connection replays instead of paying twice.
 */
export function useSettle(person: PersonRef, active: boolean) {
	const { api } = useSession();
	const [context, setContext] = useState<SettleContext | null>(null);
	const [status, setStatus] = useState<SettleStatus>("loading");
	const [direction, setDirection] = useState<Direction | null>(null);
	const [choice, setChoice] = useState<AmountChoice>({ kind: "everything" });
	const [preview, setPreview] = useState<PaymentPreview | null>(null);
	const [previewFailed, setPreviewFailed] = useState(false);
	const [recording, setRecording] = useState(false);
	const [recordFailed, setRecordFailed] = useState(false);
	// One id (also the idempotency key) per distinct request: a retry of the
	// same body replays, a changed body is a different payment.
	const write = useRef({ body: "", id: newClientId() });

	const read = useCallback(
		async (next: Direction | undefined) => {
			if (!api) return;
			setStatus("loading");
			setPreview(null);
			try {
				const ctx = await api.people.settle({
					type: person.type,
					id: person.id,
					direction: next,
				});
				setContext(ctx);
				setDirection(ctx.direction);
				setChoice({ kind: "everything" });
				setStatus("ready");
			} catch {
				setStatus("loadError");
			}
		},
		[api, person.type, person.id],
	);

	// Each opening starts from what the server suggests, with a fresh write id.
	useEffect(() => {
		if (!active) return;
		write.current = { body: "", id: newClientId() };
		setRecordFailed(false);
		read(undefined);
	}, [active, read]);

	const draft =
		context && direction
			? recordInput(person, context, direction, choice, "")
			: null;
	const inputKey = draft ? JSON.stringify({ ...draft, id: undefined }) : null;
	if (inputKey !== null && write.current.body !== inputKey) {
		write.current = { body: inputKey, id: newClientId() };
	}
	const input = draft ? { ...draft, id: write.current.id } : null;

	// The preview is a dry run of this very input; it follows every change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `inputKey` stands for `input`
	useEffect(() => {
		if (!api || status !== "ready") return;
		// A half-typed custom amount has no request: nothing to preview, and a
		// preview of the earlier choice must not stay on screen to be recorded.
		if (!input) {
			setPreview(null);
			setPreviewFailed(false);
			return;
		}
		let cancelled = false;
		setPreview(null);
		setPreviewFailed(false);
		api.payments
			.previewRecord(input)
			.then((result) => {
				if (!cancelled) setPreview(result);
			})
			.catch(() => {
				if (!cancelled) setPreviewFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [api, inputKey, status]);

	const changeDirection = useCallback(
		(next: Direction) => {
			if (next !== direction) read(next);
		},
		[direction, read],
	);

	const record = useCallback(async (): Promise<Recorded | null> => {
		if (!api || !input) return null;
		setRecording(true);
		setRecordFailed(false);
		try {
			const result = await api.payments.record(input, {
				context: { idempotencyKey: input.id },
			});
			return { status: result.status, undoToken: result.undo };
		} catch {
			setRecordFailed(true);
			return null;
		} finally {
			setRecording(false);
		}
	}, [api, input]);

	const undo = useCallback(
		async (token: string): Promise<boolean> => {
			if (!api) return false;
			try {
				await api.payments.undo(
					{ token },
					{ context: { idempotencyKey: newClientId() } },
				);
				return true;
			} catch {
				return false;
			}
		},
		[api],
	);

	return {
		context,
		status,
		direction,
		choice,
		setChoice,
		changeDirection,
		preview,
		previewFailed,
		recording,
		recordFailed,
		record,
		undo,
		retryLoad: () => read(direction ?? undefined),
	};
}
