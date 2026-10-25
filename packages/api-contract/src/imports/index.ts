import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { okSchema } from "../core";
import { previewTwin } from "../ledger";
import {
	finalizeImportSchema,
	importJobParamsSchema,
	importJobSchema,
	importReviewQuerySchema,
	importReviewSchema,
	importSummarySchema,
	importUploadSchema,
	undoImportResultSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["Imports"];

/**
 * Importing a file: upload it, wait for the reader, review the rows, then
 * finalize. The reader runs in the background, so poll the job (or listen
 * for events). Finalize and undo are money writes: each has a preview twin,
 * and undo takes the whole batch back and makes the file reviewable again.
 */
export const importsContract = {
	listJobs: v1
		.route({
			method: "GET",
			path: "/imports/jobs",
			operationId: "listImportJobs",
			tags: TAG,
			summary: "Import files, newest first",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(importJobSchema)),
	upload: v1
		.route({
			method: "POST",
			path: "/imports/jobs",
			operationId: "uploadImport",
			tags: TAG,
			summary: "Upload a file to import (multipart/form-data)",
			description:
				"Answers at once with a queued job; the file is read in the background. At most 5 files can wait or be read at a time.",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "import.uploaded" })
		.input(importUploadSchema)
		.output(importJobSchema),
	getJob: v1
		.route({
			method: "GET",
			path: "/imports/jobs/{id}",
			operationId: "getImportJob",
			tags: TAG,
			summary: "Where an import file stands",
		})
		.meta({ scope: "read" })
		.input(importJobParamsSchema)
		.output(importJobSchema),
	review: v1
		.route({
			method: "GET",
			path: "/imports/jobs/{id}/review",
			operationId: "reviewImport",
			tags: TAG,
			summary: "The rows of a read file, as the import would save them",
			description:
				"Every row with its home value at the rate the import will save, whether it is already in Activity, the kind it is proposed as and its category. Only a file that is ready can be reviewed.",
		})
		.meta({ scope: "read" })
		.input(importReviewQuerySchema)
		.output(importReviewSchema),
	finalize: v1
		.route({
			method: "POST",
			path: "/imports/jobs/{id}/finalize",
			operationId: "finalizeImport",
			tags: TAG,
			summary: "Import the rows you kept",
			description:
				"Writes the kept rows as one batch. Each row's amount, date and currency come from the stored file; the body only decides keep, category and kind per row. A file imports once. Undo with POST /imports/jobs/{id}/undo.",
		})
		.meta({ scope: "write:expenses", event: "import.finalized" })
		.input(finalizeImportSchema)
		.output(importSummarySchema),
	previewFinalize: previewTwin({
		path: "/imports/jobs/{id}/finalize",
		of: "POST /imports/jobs/{id}/finalize",
		operationId: "previewFinalizeImport",
		tags: TAG,
		scope: "write:expenses",
		input: finalizeImportSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/imports/jobs/{id}/undo",
			operationId: "undoImport",
			tags: TAG,
			summary: "Take an imported file back",
			description:
				"Deletes every row the import created, edited since or not, and returns the file to ready so it can be reviewed again.",
		})
		.meta({ scope: "write:expenses", event: "import.undone" })
		.input(importJobParamsSchema)
		.output(undoImportResultSchema),
	previewUndo: previewTwin({
		path: "/imports/jobs/{id}/undo",
		of: "POST /imports/jobs/{id}/undo",
		operationId: "previewUndoImport",
		tags: TAG,
		scope: "write:expenses",
		input: importJobParamsSchema,
	}),
	cancel: v1
		.route({
			method: "POST",
			path: "/imports/jobs/{id}/cancel",
			operationId: "cancelImport",
			tags: TAG,
			summary: "Cancel a file that is still waiting",
			description: "Only a queued file can be cancelled.",
		})
		.meta({ scope: "write:expenses", event: "import.cancelled" })
		.input(importJobParamsSchema)
		.output(importJobSchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/imports/jobs/{id}",
			operationId: "deleteImportJob",
			tags: TAG,
			summary: "Remove a file that is finished or waiting for review",
			description:
				"Not allowed while the file is queued or being read. Rows already imported stay.",
		})
		.meta({ scope: "write:expenses", event: "import.deleted" })
		.input(importJobParamsSchema)
		.output(okSchema),
};
