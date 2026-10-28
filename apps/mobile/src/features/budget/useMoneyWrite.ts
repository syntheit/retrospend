import { useCallback, useEffect, useRef, useState } from "react";
import { newClientId } from "@/data/ids";

// The shape of every money write on the phone (R30, R15): the server's dry
// run of the exact body shows what changes and what does not, Save stays off
// until it is in, the write carries one idempotency key per request body, and
// the answer ends in an Undo toast. Nothing here knows a figure.

/** `refused`: the server answered that this body can not be done (a 4xx), so retrying the same thing is pointless. */
export type PreviewStatus = "idle" | "loading" | "ready" | "failed" | "refused";

function isRefusal(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === "number" && status >= 400 && status < 500;
}

export interface MoneyWrite<P, W> {
	preview: P | null;
	status: PreviewStatus;
	committing: boolean;
	commitFailed: boolean;
	/** Sends the write; null when it did not go through (the sheet stays open). */
	commit: () => Promise<W | null>;
}

const PREVIEW_DEBOUNCE_MS = 250;

/**
 * Keys of writes the server confirmed. The server replays a key for a day, so
 * a sheet that stays mounted (write, Undo, open again, Save) must not send the
 * same one again: it would get the first answer back and change nothing. A key
 * the write failed with is not here, so a retry still replays.
 */
const spentKeys = new Set<string>();

/**
 * `input` is the exact request body (client ids included), or null while the
 * form is not complete. The preview follows every change of it; the write
 * uses the same body and `idempotencyKey`, so a retry after a dropped
 * connection replays the first answer instead of writing twice.
 */
export function useMoneyWrite<I, P, W>(options: {
	input: I | null;
	idempotencyKey: string | null;
	preview: (input: I) => Promise<P>;
	write: (input: I, idempotencyKey: string) => Promise<W>;
	debounceMs?: number;
}): MoneyWrite<P, W> {
	const { input, debounceMs = PREVIEW_DEBOUNCE_MS } = options;
	const latest = useRef(options);
	latest.current = options;
	const [preview, setPreview] = useState<P | null>(null);
	const [status, setStatus] = useState<PreviewStatus>("idle");
	// The body the state above answered. The effect that fetches runs after the
	// render in which the body changed, so for that frame the old answer is not
	// this body's and must not read as ready.
	const [answeredKey, setAnsweredKey] = useState<string | null>(null);
	const [committing, setCommitting] = useState(false);
	const [commitFailed, setCommitFailed] = useState(false);
	const busy = useRef(false);
	const bodyKey = input === null ? null : JSON.stringify(input);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `bodyKey` stands for `input`
	useEffect(() => {
		setPreview(null);
		setCommitFailed(false);
		const body = latest.current.input;
		if (body === null) {
			setStatus("idle");
			return;
		}
		setStatus("loading");
		let cancelled = false;
		const timer = setTimeout(() => {
			latest.current
				.preview(body)
				.then((result) => {
					if (cancelled) return;
					setPreview(result);
					setStatus("ready");
					setAnsweredKey(bodyKey);
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					setStatus(isRefusal(error) ? "refused" : "failed");
					setAnsweredKey(bodyKey);
				});
		}, debounceMs);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [bodyKey, debounceMs]);

	const commit = useCallback(async (): Promise<W | null> => {
		const { input: body, idempotencyKey, write } = latest.current;
		if (body === null || idempotencyKey === null || busy.current) return null;
		busy.current = true;
		setCommitting(true);
		setCommitFailed(false);
		try {
			const answer = await write(body, idempotencyKey);
			// The write is done: its key must never be sent for another one.
			spentKeys.add(idempotencyKey);
			return answer;
		} catch {
			setCommitFailed(true);
			return null;
		} finally {
			busy.current = false;
			setCommitting(false);
		}
	}, []);

	const fresh = bodyKey !== null && answeredKey === bodyKey;
	return {
		preview: fresh ? preview : null,
		status: bodyKey === null ? "idle" : fresh ? status : "loading",
		committing,
		commitFailed,
		commit,
	};
}

/**
 * One id per name for as long as the request body is the same: the same body
 * sent again is the same write (a replay), a changed body is a different one.
 * Call `reset` when a sheet opens so a second opening never reuses an id. A
 * confirmed write retires its ids by itself (see `spentKeys`).
 */
export function useWriteIds(bodyKey: string | null) {
	const state = useRef({ body: "", ids: new Map<string, string>() });
	if (bodyKey !== null && state.current.body !== bodyKey) {
		state.current = { body: bodyKey, ids: new Map() };
	}
	const idFor = useCallback((name: string): string => {
		const known = state.current.ids.get(name);
		if (known && !spentKeys.has(known)) return known;
		const made = newClientId();
		state.current.ids.set(name, made);
		return made;
	}, []);
	const reset = useCallback(() => {
		state.current = { body: "", ids: new Map() };
	}, []);
	return { idFor, reset };
}
