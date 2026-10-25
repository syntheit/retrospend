import * as projects from "~/server/services/api-v1/projects";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.projects;

export const projectsRouter = {
	list: p.list.handler(
		serve(({ context }) => projects.listProjects(signedIn(context))),
	),
	get: p.get.handler(
		serve(({ context, input }) =>
			projects.readProject(signedIn(context), input.id),
		),
	),
	members: p.members.handler(
		serve(({ context, input }) =>
			projects.listMembersOn(signedIn(context), input.id, input.date),
		),
	),
	summary: p.summary.handler(
		serve(({ context, input }) =>
			projects.readSummary(signedIn(context), input.id, input.periodId),
		),
	),
	settleAllPlan: p.settleAllPlan.handler(
		serve(({ context, input }) =>
			projects.readSettleAllPlan(signedIn(context), input.id),
		),
	),
	settleAll: p.settleAll.handler(
		serve(({ context, input }) =>
			projects.settleAllWrite(signedIn(context), input.id, input.expect),
		),
	),
	previewSettleAll: p.previewSettleAll.handler(
		serve(({ context, input }) =>
			projects.previewSettleAllWrite(signedIn(context), input.id, input.expect),
		),
	),
	undoSettleAll: p.undoSettleAll.handler(
		serve(({ context, input }) =>
			projects.undoSettleAllWrite(signedIn(context), input.id, input.token),
		),
	),
	previewUndoSettleAll: p.previewUndoSettleAll.handler(
		serve(({ context, input }) =>
			projects.previewUndoSettleAllWrite(
				signedIn(context),
				input.id,
				input.token,
			),
		),
	),
};
