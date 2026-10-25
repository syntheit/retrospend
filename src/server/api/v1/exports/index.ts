import * as exportsService from "~/server/services/api-v1/exports";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const e = v1.exports;

export const exportsRouter = {
	listJobs: e.listJobs.handler(
		serve(({ context, input }) =>
			exportsService.listJobs(signedIn(context), input),
		),
	),
	request: e.request.handler(
		serve(({ context, input }) =>
			exportsService.requestExport(signedIn(context), input),
		),
	),
	getJob: e.getJob.handler(
		serve(({ context, input }) =>
			exportsService.getJob(signedIn(context), input.id),
		),
	),
	download: e.download.handler(
		serve(({ context, input }) =>
			exportsService.downloadFile(signedIn(context), input),
		),
	),
	delete: e.delete.handler(
		serve(({ context, input }) =>
			exportsService.deleteJob(signedIn(context), input.id),
		),
	),
};
