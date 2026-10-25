import type { RetrospendClient } from "@retrospend/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { isConflict } from "./settleAll";

export type SettleAllPlan = Awaited<
	ReturnType<RetrospendClient["projects"]["settleAllPlan"]>
>;
export type SettleAllPreview = Awaited<
	ReturnType<RetrospendClient["projects"]["previewSettleAll"]>
>;
export type SettleAllDone = Awaited<
	ReturnType<RetrospendClient["projects"]["settleAll"]>
>;

export type SettleAllStatus = "loading" | "ready" | "loadError";

/**
 * Settle all inside one project: what is open (the plan), the server's dry
 * run of the write with exactly those lines, and the write itself, sent
 * with the lines the person saw so it refuses when the balances moved
 * (R30). The idempotency key follows the lines, so a retry replays and a
 * changed plan is a different write.
 */
export function useSettleAll(projectId: string, active: boolean) {
	const { api } = useSession();
	const [plan, setPlan] = useState<SettleAllPlan | null>(null);
	const [status, setStatus] = useState<SettleAllStatus>("loading");
	const [preview, setPreview] = useState<SettleAllPreview | null>(null);
	const [previewFailed, setPreviewFailed] = useState(false);
	const [recording, setRecording] = useState(false);
	const [recordFailed, setRecordFailed] = useState<"error" | "moved" | null>(
		null,
	);
	const write = useRef({ body: "", id: newClientId() });

	const read = useCallback(async () => {
		if (!api) return;
		setStatus("loading");
		setPreview(null);
		try {
			setPlan(await api.projects.settleAllPlan({ id: projectId }));
			setStatus("ready");
		} catch {
			setStatus("loadError");
		}
	}, [api, projectId]);

	useEffect(() => {
		if (!active) return;
		write.current = { body: "", id: newClientId() };
		setRecordFailed(null);
		read();
	}, [active, read]);

	const body = plan ? JSON.stringify(plan.planned) : null;
	if (body !== null && write.current.body !== body) {
		write.current = { body, id: newClientId() };
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: `body` stands for `plan`
	useEffect(() => {
		if (!api || !plan || status !== "ready" || plan.planned.length === 0) {
			return;
		}
		let cancelled = false;
		setPreview(null);
		setPreviewFailed(false);
		api.projects
			.previewSettleAll({ id: projectId, expect: plan.planned })
			.then((result) => !cancelled && setPreview(result))
			.catch(() => !cancelled && setPreviewFailed(true));
		return () => {
			cancelled = true;
		};
	}, [api, body, status, projectId]);

	const record = useCallback(async (): Promise<SettleAllDone | null> => {
		if (!api || !plan) return null;
		setRecording(true);
		setRecordFailed(null);
		try {
			return await api.projects.settleAll(
				{ id: projectId, expect: plan.planned },
				{ context: { idempotencyKey: write.current.id } },
			);
		} catch (error) {
			if (isConflict(error)) {
				setRecordFailed("moved");
				read();
			} else {
				setRecordFailed("error");
			}
			return null;
		} finally {
			setRecording(false);
		}
	}, [api, plan, projectId, read]);

	const undo = useCallback(
		async (token: string): Promise<boolean> => {
			if (!api) return false;
			try {
				await api.projects.undoSettleAll(
					{ id: projectId, token },
					{ context: { idempotencyKey: newClientId() } },
				);
				return true;
			} catch {
				return false;
			}
		},
		[api, projectId],
	);

	return {
		plan,
		status,
		preview,
		previewFailed,
		recording,
		recordFailed,
		record,
		undo,
		retryLoad: read,
	};
}
