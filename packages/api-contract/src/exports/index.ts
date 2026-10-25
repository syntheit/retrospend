import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { okSchema } from "../core";
import {
	exportDownloadQuerySchema,
	exportJobParamsSchema,
	exportJobSchema,
	exportRequestSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["Exports"];

/**
 * Exports are asynchronous jobs: request one, read the job until it is
 * ready, then download the file with the link the job carries. The link
 * works for 10 minutes and only for its owner; the file is deleted after 24
 * hours. Requesting an export needs `write:settings` because it creates a
 * job, though it reads data.
 */
export const exportsContract = {
	listJobs: v1
		.route({
			method: "GET",
			path: "/exports/jobs",
			operationId: "listExportJobs",
			tags: TAG,
			summary: "Your export jobs, newest first",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(exportJobSchema)),
	request: v1
		.route({
			method: "POST",
			path: "/exports/jobs",
			operationId: "requestExport",
			tags: TAG,
			summary: "Start an export",
			description:
				"Answers at once with a queued job. At most 3 exports can wait or run at a time.",
			successStatus: 202,
		})
		.meta({ scope: "write:settings", event: "export.requested" })
		.input(exportRequestSchema)
		.output(exportJobSchema),
	getJob: v1
		.route({
			method: "GET",
			path: "/exports/jobs/{id}",
			operationId: "getExportJob",
			tags: TAG,
			summary: "Where an export stands, with a fresh download link when ready",
		})
		.meta({ scope: "read" })
		.input(exportJobParamsSchema)
		.output(exportJobSchema),
	download: v1
		.route({
			method: "GET",
			path: "/exports/jobs/{id}/download",
			operationId: "downloadExport",
			tags: TAG,
			summary: "The finished file",
			description:
				"The `token` query comes from the job's download link and expires after 10 minutes. The caller must be the job's owner as well.",
		})
		.meta({ scope: "read" })
		.input(exportDownloadQuerySchema)
		.output(z.file()),
	delete: v1
		.route({
			method: "DELETE",
			path: "/exports/jobs/{id}",
			operationId: "deleteExportJob",
			tags: TAG,
			summary: "Delete an export and its file",
		})
		.meta({ scope: "write:settings", event: "export.deleted" })
		.input(exportJobParamsSchema)
		.output(okSchema),
};
