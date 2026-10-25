import * as imports from "~/server/services/api-v1/imports";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const i = v1.imports;

export const importsRouter = {
	listJobs: i.listJobs.handler(
		serve(({ context, input }) => imports.listJobs(signedIn(context), input)),
	),
	upload: i.upload.handler(
		serve(({ context, input }) => imports.upload(signedIn(context), input)),
	),
	getJob: i.getJob.handler(
		serve(({ context, input }) => imports.getJob(signedIn(context), input.id)),
	),
	review: i.review.handler(
		serve(({ context, input }) => imports.review(signedIn(context), input)),
	),
	finalize: i.finalize.handler(
		serve(({ context, input }) => imports.finalize(signedIn(context), input)),
	),
	previewFinalize: i.previewFinalize.handler(
		serve(({ context, input }) =>
			imports.previewFinalize(signedIn(context), input),
		),
	),
	undo: i.undo.handler(
		serve(({ context, input }) => imports.undo(signedIn(context), input.id)),
	),
	previewUndo: i.previewUndo.handler(
		serve(({ context, input }) =>
			imports.previewUndo(signedIn(context), input.id),
		),
	),
	cancel: i.cancel.handler(
		serve(({ context, input }) => imports.cancel(signedIn(context), input.id)),
	),
	delete: i.delete.handler(
		serve(({ context, input }) => imports.remove(signedIn(context), input.id)),
	),
};
