"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "~/components/ui/toast";
import type { ImportSummary } from "~/server/services/import/commit.mutation";
import type { RecentImport } from "~/server/services/import/recent";
import { api } from "~/trpc/react";
import {
	base64Of,
	type CsvHeader,
	type FileKind,
	fileKindOf,
	MAX_FILE_BYTES,
	readCsvHeader,
} from "./file";

export type Flow =
	| { step: "choose" }
	| { step: "read"; file: File; kind: FileKind; header: CsvHeader | null }
	| { step: "reading"; jobId: string; name: string; file?: File }
	| { step: "review"; jobId: string; file?: File }
	| { step: "done"; summary: ImportSummary };

export type ReadAs = "CSV" | "BANK_STATEMENT";

/** While a file is being read the list refreshes; otherwise it rests. */
const POLL_MS = 2000;

const anyReading = (rows: readonly RecentImport[] | undefined) =>
	rows?.some((r) => r.state === "reading") ?? false;

/**
 * The Import page's steps: Choose file, Read it, Review, Done. A CSV in the
 * Retrospend format skips Read it (the fast path). Reading happens in the
 * queue; the page follows the job in Recent imports and opens its review
 * when it is ready.
 */
export function useImportFlow(initialJob: string | null) {
	const t = useTranslations("importPage");
	const toast = useToast();
	const [flow, setFlow] = useState<Flow>(
		initialJob ? { step: "review", jobId: initialJob } : { step: "choose" },
	);
	const [error, setError] = useState<string | null>(null);
	const reading = flow.step === "reading";
	const recent = api.importQueue.recent.useQuery(undefined, {
		refetchInterval: (q) =>
			reading || anyReading(q.state.data) ? POLL_MS : false,
	});
	const createJob = api.importQueue.createJob.useMutation();

	// Follow the job being read: open its review, or say why it failed.
	useEffect(() => {
		if (flow.step !== "reading") return;
		const job = recent.data?.find((j) => j.id === flow.jobId);
		if (job?.state === "review")
			setFlow({ step: "review", jobId: job.id, file: flow.file });
		else if (job?.state === "failed") {
			setError(t("reading.failed", { name: flow.name }));
			setFlow({ step: "choose" });
		}
	}, [flow, recent.data, t]);

	const start = useCallback(
		async (file: File, kind: FileKind, as: ReadAs) => {
			setError(null);
			try {
				const job = await createJob.mutateAsync({
					fileName: file.name,
					fileSize: file.size,
					fileType: kind,
					type: as,
					fileData: await base64Of(file),
				});
				setFlow({ step: "reading", jobId: job.id, name: file.name, file });
				void recent.refetch();
			} catch (e) {
				setError(
					t("read.failed", {
						name: file.name,
						reason: e instanceof Error ? e.message : "",
					}),
				);
				setFlow({ step: "choose" });
			}
		},
		[createJob, recent, t],
	);

	/**
	 * A dropped or picked file: checked here, then read. `ask` shows "Read
	 * it" even for a Retrospend CSV (Change how it is read).
	 */
	const accept = useCallback(
		async (file: File, options: { ask?: boolean } = {}) => {
			const kind = fileKindOf(file.name);
			if (!kind) return setError(t("drop.wrongType", { name: file.name }));
			if (file.size > MAX_FILE_BYTES)
				return setError(t("drop.tooBig", { name: file.name }));
			setError(null);
			const header = kind === "csv" ? readCsvHeader(await file.text()) : null;
			if (header?.retrospend && !options.ask) {
				toast.info(t("read.fastPath"));
				return start(file, kind, "CSV");
			}
			setFlow({ step: "read", file, kind, header });
		},
		[start, t, toast],
	);

	return {
		flow,
		setFlow,
		error,
		setError,
		recent,
		accept,
		start,
		starting: createJob.isPending,
	};
}

export type ImportFlow = ReturnType<typeof useImportFlow>;
