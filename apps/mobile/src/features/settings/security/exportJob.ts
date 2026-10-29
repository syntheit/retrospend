import type { ExportJobDto } from "@retrospend/api-contract";

/** What the phone exports: everything as a ZIP, or the expenses as one CSV. */
export type ExportKind = "data" | "expenses";

export class ExportFailedError extends Error {
	constructor(readonly state: ExportJobDto["state"]) {
		super(`The export ended ${state}`);
	}
}

/** Waits between reads of a job: short at first, then longer. */
export function pollDelay(attempt: number): number {
	return Math.min(500 * 2 ** attempt, 4000);
}

/** About two minutes of waiting before the phone gives up on a job. */
export const MAX_POLLS = 35;

/**
 * Asks the server for an export and reads the job until it is ready, then
 * returns the ready job (its download link is fresh). A failed or expired
 * job, or one that takes too long, throws.
 */
export async function waitForExport(deps: {
	request(): Promise<ExportJobDto>;
	read(id: string): Promise<ExportJobDto>;
	wait(ms: number): Promise<void>;
}): Promise<
	ExportJobDto & { download: NonNullable<ExportJobDto["download"]> }
> {
	let job = await deps.request();
	for (let attempt = 0; ; attempt++) {
		if (job.state === "ready" && job.download)
			return job as ExportJobDto & {
				download: NonNullable<ExportJobDto["download"]>;
			};
		if (job.state === "failed" || job.state === "expired")
			throw new ExportFailedError(job.state);
		if (attempt >= MAX_POLLS) throw new ExportFailedError(job.state);
		await deps.wait(pollDelay(attempt));
		job = await deps.read(job.id);
	}
}

/** The share sheet's file type for a job's format. */
export function mimeOf(format: ExportJobDto["format"]): string {
	if (format === "zip") return "application/zip";
	if (format === "pdf") return "application/pdf";
	return "text/csv";
}

/** iOS wants a uniform type identifier as well. */
export function utiOf(format: ExportJobDto["format"]): string {
	if (format === "zip") return "public.zip-archive";
	if (format === "pdf") return "com.adobe.pdf";
	return "public.comma-separated-values-text";
}

/** A file name the phone can store: no folders, nothing odd, never empty. */
export function safeFileName(name: string | null, fallback: string): string {
	const cleaned = [...(name ?? "")]
		.map((c) => (c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c) ? "_" : c))
		.join("")
		.trim();
	return cleaned === "" || cleaned === "." || cleaned === ".."
		? fallback
		: cleaned;
}
