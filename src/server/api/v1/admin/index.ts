import * as admin from "~/server/services/api-v1/admin";
import * as feedback from "~/server/services/api-v1/feedback";
import * as invites from "~/server/services/api-v1/invite-codes";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const a = v1.admin;

export const adminRouter = {
	stats: a.stats.handler(
		serve(({ context }) => admin.stats(signedIn(context))),
	),
	listUsers: a.listUsers.handler(
		serve(({ context, input }) => admin.listUsers(signedIn(context), input)),
	),
	disableUser: a.disableUser.handler(
		serve(({ context, input }) =>
			admin.setActive(signedIn(context), input.id, false),
		),
	),
	enableUser: a.enableUser.handler(
		serve(({ context, input }) =>
			admin.setActive(signedIn(context), input.id, true),
		),
	),
	setEmailVerified: a.setEmailVerified.handler(
		serve(({ context, input }) =>
			admin.setEmailVerified(signedIn(context), input),
		),
	),
	setAiAccess: a.setAiAccess.handler(
		serve(({ context, input }) => admin.setAiAccess(signedIn(context), input)),
	),
	removeAvatar: a.removeAvatar.handler(
		serve(({ context, input }) =>
			admin.removeAvatar(signedIn(context), input.id),
		),
	),
	deleteUser: a.deleteUser.handler(
		serve(({ context, input }) =>
			admin.deleteUser(signedIn(context), input.id),
		),
	),
	getSettings: a.getSettings.handler(
		serve(({ context }) => admin.getSettings(signedIn(context))),
	),
	updateSettings: a.updateSettings.handler(
		serve(({ context, input }) =>
			admin.updateSettings(signedIn(context), input),
		),
	),
	getAiSettings: a.getAiSettings.handler(
		serve(({ context }) => admin.getAiSettings(signedIn(context))),
	),
	updateAiSettings: a.updateAiSettings.handler(
		serve(({ context, input }) =>
			admin.updateAiSettings(signedIn(context), input),
		),
	),
	aiUsage: a.aiUsage.handler(
		serve(({ context, input }) => admin.aiUsage(signedIn(context), input)),
	),
	eventLogs: a.eventLogs.handler(
		serve(({ context, input }) => admin.eventLogs(signedIn(context), input)),
	),
	getBackups: a.getBackups.handler(
		serve(({ context }) => admin.backupStatus(signedIn(context))),
	),
	startBackup: a.startBackup.handler(
		serve(({ context }) => admin.startBackup(signedIn(context))),
	),
	listInviteCodes: a.listInviteCodes.handler(
		serve(({ context, input }) => invites.listAll(signedIn(context), input)),
	),
	createInviteCode: a.createInviteCode.handler(
		serve(({ context }) => invites.createAny(signedIn(context))),
	),
	deleteInviteCode: a.deleteInviteCode.handler(
		serve(({ context, input }) =>
			invites.deleteAny(signedIn(context), input.id),
		),
	),
	listFeedback: a.listFeedback.handler(
		serve(({ context, input }) => feedback.listInbox(signedIn(context), input)),
	),
	setFeedbackStatus: a.setFeedbackStatus.handler(
		serve(({ context, input }) => feedback.setStatus(signedIn(context), input)),
	),
	setFeedbackNote: a.setFeedbackNote.handler(
		serve(({ context, input }) => feedback.setNote(signedIn(context), input)),
	),
	deleteFeedback: a.deleteFeedback.handler(
		serve(({ context, input }) => feedback.remove(signedIn(context), input.id)),
	),
};
