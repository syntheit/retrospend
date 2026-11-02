import type { ExportRequest } from "@retrospend/api-contract";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { createTokenStore } from "@/auth/token-store";
import { newClientId } from "@/data/ids";
import { dayKey } from "@/lib/days";
import { webUrl } from "../webPages";
import { exportFile, removeFile, shareThenDelete } from "./exportFiles";
import {
	type ExportKind,
	mimeOf,
	safeFileName,
	utiOf,
	waitForExport,
} from "./exportJob";

/**
 * Everything, the expenses (export jobs) and the open accounts (a CSV read);
 * a full request asks for one project's or one person's document.
 */
export type DataKind = ExportKind | "wealth";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Today as yyyy-mm-dd on the phone's clock, for a file name. */
const today = () => dayKey(new Date());

/**
 * Exports put the file on the phone and open the system share sheet, where
 * it can be saved to Files, sent or opened elsewhere. The server builds the
 * file as a job; the phone reads the job until it is ready and downloads it
 * with its own sign-in (the link alone opens nothing). The copy is deleted
 * once the share sheet closes (exportFiles.ts).
 */
export function useDataExport() {
	const { api } = useSession();
	const { connection } = useServerConnection();
	const [busy, setBusy] = useState<string | null>(null);

	async function share(file: File, mimeType: string, UTI: string) {
		await shareThenDelete(file, async (f) => {
			if (!(await Sharing.isAvailableAsync()))
				throw new Error("no share sheet");
			await Sharing.shareAsync(f.uri, { mimeType, UTI });
		});
	}

	async function exportJob(request: ExportRequest, baseUrl: string) {
		if (!api) throw new Error("signed out");
		const key = newClientId();
		const job = await waitForExport({
			request: () =>
				api.exports.request(request, { context: { idempotencyKey: key } }),
			read: (id) => api.exports.getJob({ id }),
			wait,
		});
		const token = await createTokenStore(baseUrl).get();
		if (!token) throw new Error("signed out");
		const fallback =
			request.kind === "data"
				? `retrospend-${today()}.zip`
				: request.kind === "expenses"
					? `expenses-${today()}.csv`
					: `${request.kind.replace(/_/g, "-")}-${today()}.${job.format}`;
		const target = exportFile(safeFileName(job.fileName, fallback));
		let file: File;
		try {
			file = await File.downloadFileAsync(
				webUrl(baseUrl, job.download.url),
				target,
				{ headers: { authorization: `Bearer ${token}` }, idempotent: true },
			);
		} catch (error) {
			removeFile(target);
			throw error;
		}
		await share(file, mimeOf(job.format), utiOf(job.format));
	}

	async function exportWealth() {
		if (!api) throw new Error("signed out");
		const { csv } = await api.accounts.export();
		const file = exportFile(`wealth-${today()}.csv`);
		try {
			file.create({ overwrite: true });
			await file.write(csv);
		} catch (error) {
			removeFile(file);
			throw error;
		}
		await share(file, mimeOf("csv"), utiOf("csv"));
	}

	/** Resolves true once the share sheet opened, false when it failed. */
	async function run(what: DataKind | ExportRequest): Promise<boolean> {
		if (busy || connection.status !== "connected") return false;
		const kind = typeof what === "string" ? what : what.kind;
		setBusy(kind);
		try {
			if (what === "wealth") await exportWealth();
			else
				await exportJob(
					typeof what === "string" ? { kind: what } : what,
					connection.baseUrl,
				);
			return true;
		} catch {
			return false;
		} finally {
			setBusy(null);
		}
	}

	return { busy, run };
}
