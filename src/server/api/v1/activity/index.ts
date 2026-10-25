import * as activity from "~/server/services/api-v1/activity";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const a = v1.activity;

export const activityRouter = {
	feed: a.feed.handler(
		serve(({ context, input }) =>
			activity.listActivity(signedIn(context), input),
		),
	),
	filters: a.filters.handler(
		serve(({ context, input }) =>
			activity.readActivityFilters(signedIn(context), input.id),
		),
	),
	lastActivity: a.lastActivity.handler(
		serve(({ context, input }) =>
			activity.readLastActivity(signedIn(context), input.ids),
		),
	),
	history: a.history.handler(
		serve(({ context, input }) =>
			activity.readExpenseHistory(signedIn(context), input.id),
		),
	),
	revisions: a.revisions.handler(
		serve(({ context, input }) =>
			activity.readRevisions(signedIn(context), input.ids),
		),
	),
	markSeen: a.markSeen.handler(
		serve(({ context, input }) =>
			activity.markSeen(signedIn(context), input.id),
		),
	),
};
