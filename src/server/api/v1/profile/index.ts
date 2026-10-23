import * as profile from "~/server/services/api-v1/profile";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.profile;

export const profileRouter = {
	get: p.get.handler(
		serve(({ context }) => profile.readProfile(signedIn(context))),
	),
	update: p.update.handler(
		serve(({ context, input }) =>
			profile.patchProfile(signedIn(context), input),
		),
	),
	cancelEmailChange: p.cancelEmailChange.handler(
		serve(({ context }) => profile.dropPendingEmail(signedIn(context))),
	),
	setAvatar: p.setAvatar.handler(
		serve(({ context, input }) =>
			profile.putAvatar(signedIn(context), input.file),
		),
	),
	removeAvatar: p.removeAvatar.handler(
		serve(({ context }) => profile.deleteAvatar(signedIn(context))),
	),
	getBackground: p.getBackground.handler(
		serve(({ context }) => profile.readBackground(signedIn(context))),
	),
	setBackground: p.setBackground.handler(
		serve(({ context, input }) =>
			profile.putBackground(signedIn(context), input),
		),
	),
};
