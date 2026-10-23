import * as notifications from "~/server/services/api-v1/notifications";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const n = v1.notifications;

export const notificationsRouter = {
	list: n.list.handler(
		serve(({ context, input }) =>
			notifications.listNotificationPage(signedIn(context), input),
		),
	),
	unreadCount: n.unreadCount.handler(
		serve(({ context }) => notifications.unreadCount(signedIn(context))),
	),
	markRead: n.markRead.handler(
		serve(({ context, input }) =>
			notifications.readOne(signedIn(context), input.id),
		),
	),
	markAllRead: n.markAllRead.handler(
		serve(({ context }) => notifications.readAll(signedIn(context))),
	),
	getPreferences: n.getPreferences.handler(
		serve(({ context }) => notifications.readPreferences(signedIn(context))),
	),
	updatePreferences: n.updatePreferences.handler(
		serve(({ context, input }) =>
			notifications.writePreferences(signedIn(context), input.preferences),
		),
	),
};
