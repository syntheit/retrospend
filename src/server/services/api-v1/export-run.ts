import type { ExportRequest } from "@retrospend/api-contract";
import { dayKey } from "~/lib/time-zone";
import { deleteFile, uploadFile } from "~/server/storage";
import { scopedDbFor } from "./scoped-db";
import { type BridgeCaller, trpcExpense, trpcExport } from "./trpc-bridge";

/**
 * Builds one export in the background. The documents are the ones the web
 * app downloads (the export tRPC procedures); this only stores their bytes.
 * A failure is recorded on the job and never thrown at the request that
 * started it.
 */

type Built = { bytes: Buffer; fileName: string; contentType: string };

const CSV = "text/csv; charset=utf-8";

/** Where a job's file lives in the upload store. */
export const storagePathFor = (userId: string, jobId: string) =>
	`exports/${userId}/${jobId}`;

const csv = (r: { csv: string; filename: string }): Built => ({
	bytes: Buffer.from(r.csv, "utf8"),
	fileName: r.filename,
	contentType: CSV,
});

const pdf = (r: { pdf: string; filename: string }): Built => ({
	bytes: Buffer.from(r.pdf, "base64"),
	fileName: r.filename,
	contentType: "application/pdf",
});

async function build(who: BridgeCaller, req: ExportRequest): Promise<Built> {
	const t = await trpcExport(who);
	switch (req.kind) {
		case "data": {
			const r = await t.allData();
			return {
				bytes: Buffer.from(r.zipData, "base64"),
				fileName: r.filename,
				contentType: "application/zip",
			};
		}
		case "expenses": {
			const r = await (await trpcExpense(who)).exportCsv({
				expenseIds: req.expenseIds,
			});
			return csv({
				csv: r.csv,
				filename: `expenses-${dayKey(new Date(), who.timeZone)}.csv`,
			});
		}
		case "project_expenses":
			return csv(await t.exportProjectExpenses({ ...req, format: "csv" }));
		case "project_settlement_plan":
			return csv(await t.exportSettlementPlan({ ...req, format: "csv" }));
		case "project_billing_period":
			return csv(await t.exportBillingPeriodSummary({ ...req, format: "csv" }));
		case "project_pdf":
			return pdf(await t.exportProjectPdf(req));
		case "person_history":
			return csv(await t.exportPersonHistory({ ...req, format: "csv" }));
		case "person_settlement_plan":
			return csv(await t.exportPersonSettlementPlan({ ...req, format: "csv" }));
		case "person_pdf":
			return pdf(await t.exportPersonPdf(req));
	}
}

function messageOf(error: unknown): string {
	const text = error instanceof Error ? error.message : "The export failed";
	return text.slice(0, 500);
}

export async function runExportJob(jobId: string, userId: string) {
	const db = scopedDbFor(userId);
	// Claims the job, so a second runner never builds it again.
	const claimed = await db.exportJob.updateMany({
		where: { id: jobId, userId, status: "QUEUED" },
		data: { status: "RUNNING", startedAt: new Date() },
	});
	if (claimed.count === 0) return;
	try {
		const job = await db.exportJob.findFirstOrThrow({
			where: { id: jobId, userId },
		});
		const built = await build(
			{ principal: { userId }, timeZone: job.timeZone },
			{ ...(job.params as object), kind: job.kind } as ExportRequest,
		);
		const path = storagePathFor(userId, jobId);
		await uploadFile(path, built.bytes, built.contentType);
		const done = await db.exportJob.updateMany({
			where: { id: jobId, userId },
			data: {
				status: "READY",
				fileName: built.fileName.slice(0, 255),
				contentType: built.contentType,
				sizeBytes: built.bytes.length,
				storagePath: path,
				completedAt: new Date(),
			},
		});
		// The owner deleted the job while it ran: nothing may keep the file.
		if (done.count === 0) await deleteFile(path).catch(() => {});
	} catch (error) {
		await db.exportJob
			.updateMany({
				where: { id: jobId, userId },
				data: {
					status: "FAILED",
					error: messageOf(error),
					completedAt: new Date(),
				},
			})
			.catch(() => {});
	}
}
