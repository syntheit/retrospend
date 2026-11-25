import * as protection from "~/server/services/api-v1/protection";
import { serve } from "../core/serve";
import { withTries } from "../core/with-tries";
import { signedIn, v1 } from "../middleware";

const p = v1.protection;

export const protectionRouter = {
	enable: p.enable.handler(
		serve(({ context, input }) =>
			withTries(context, () => protection.enable(signedIn(context), input)),
		),
	),
	keys: p.keys.handler(
		serve(({ context }) => protection.readKeys(signedIn(context))),
	),
	openKeys: p.openKeys.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.openKeys(signedIn(context), input.authKey),
			),
		),
	),
	beginPasswordRotation: p.beginPasswordRotation.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.beginPasswordRotation(
					signedIn(context),
					input.currentAuthKey,
				),
			),
		),
	),
	rotatePassword: p.rotatePassword.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.changeKeyedPassword(signedIn(context), input),
			),
		),
	),
	newRecoveryKey: p.newRecoveryKey.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.newRecoveryKey(signedIn(context), input),
			),
		),
	),
};
