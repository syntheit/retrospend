import { useCallback, useEffect, useRef, useState } from "react";
import { newClientId } from "@/data/ids";

// The shape of every money write on the phone (R30, R15): the server's dry
// run of the exact body shows what changes and what does not, Save stays off
// until it is in, the write carries one idempotency key per request body, and
// the answer ends in an Undo toast. Nothing here knows a figure.

export type PreviewStatus = "idle" | "loading" | "ready" | "failed";

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
				})
				.catch(() => {
					if (!cancelled) setStatus("failed");
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
			return await write(body, idempotencyKey);
		} catch {
			setCommitFailed(true);
			return null;
		} finally {
			busy.current = false;
			setCommitting(false);
		}
	}, []);

	return { preview, status, committing, commitFailed, commit };
}

/**
 * One id per name for as long as the request body is the same: the same body
 * sent again is the same write (a replay), a changed body is a different one.
 * Call `reset` when a sheet opens so a second opening never reuses an id.
 */
export function useWriteIds(bodyKey: string | null) {
	const state = useRef({ body: "", ids: new Map<string, string>() });
	if (bodyKey !== null && state.current.body !== bodyKey) {
		state.current = { body: bodyKey, ids: new Map() };
	}
	const idFor = useCallback((name: string): string => {
		const known = state.current.ids.get(name);
		if (known) return known;
		const made = newClientId();
		state.current.ids.set(name, made);
		return made;
	}, []);
	const reset = useCallback(() => {
		state.current = { body: "", ids: new Map() };
	}, []);
	return { idFor, reset };
}
