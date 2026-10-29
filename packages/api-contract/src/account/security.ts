import * as z from "zod";
import { v1 } from "../common/meta";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

const TAG = ["Account"];

/** The rule the server holds a new password to (the web shows it as checks). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 255;
export const PASSWORD_PATTERN = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

export const changePasswordSchema = z
	.object({
		currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
		newPassword: z
			.string()
			.min(PASSWORD_MIN_LENGTH)
			.max(PASSWORD_MAX_LENGTH)
			.regex(
				PASSWORD_PATTERN,
				"Use a lowercase and an uppercase letter and a number",
			)
			.meta({
				description:
					"8 or more characters with a lowercase and an uppercase letter and a number.",
			}),
	})
	.meta({ id: "ChangePassword" });

export const changePasswordResultSchema = z
	.object({
		/** How many other sessions the change signed out. */
		signedOut: z.int().min(0),
	})
	.meta({ id: "ChangePasswordResult" });

/** Who made a session: the web app, the Expo app, or a device-authorized client. */
export const SESSION_KINDS = ["web", "mobile", "device"] as const;

export const signedInSessionSchema = z
	.object({
		id: idSchema,
		kind: z.enum(SESSION_KINDS),
		/** The device client id (retrospend-cli) or the Expo app's; null for the web. */
		clientId: z.string().nullable(),
		/** The user agent it signed in with, to tell sessions apart. */
		userAgent: z.string().nullable(),
		/** The session this request came with. */
		current: z.boolean(),
		createdAt: timestampSchema,
		lastUsedAt: timestampSchema,
	})
	.meta({ id: "SignedInSession" });

export type SignedInSessionDto = z.infer<typeof signedInSessionSchema>;

export const signedInSessionsSchema = z
	.object({ items: z.array(signedInSessionSchema) })
	.meta({ id: "SignedInSessions" });

/**
 * Password and sessions. Only the person's own sign-in may use them (scope
 * `account:security`, like `account:delete`): no API key or device session
 * holds it. Two-factor stays on the web, where better-auth runs it.
 */
export const accountSecurityContract = {
	changePassword: v1
		.route({
			method: "POST",
			path: "/me/password",
			operationId: "changeMyPassword",
			tags: TAG,
			summary: "Change your password",
			description:
				"Needs the current password, every time (5 tries in 15 minutes, then 429). Signs out every other session; the one making the change stays signed in.",
		})
		.meta({ scope: "account:security", event: "user.password_changed" })
		.input(changePasswordSchema)
		.output(changePasswordResultSchema),
	sessions: v1
		.route({
			method: "GET",
			path: "/me/sessions",
			operationId: "listMySessions",
			tags: TAG,
			summary: "Where you are signed in, most recently used first",
			description:
				"Web, app and device sessions that have not expired. No token is ever returned.",
		})
		.meta({ scope: "account:security" })
		.output(signedInSessionsSchema),
	endSession: v1
		.route({
			method: "DELETE",
			path: "/me/sessions/{id}",
			operationId: "endMySession",
			tags: TAG,
			summary: "Sign out one of your sessions",
			description:
				"Its token stops working on its next request. The session making the request is refused: sign out instead.",
		})
		.meta({ scope: "account:security", event: "user.session_ended" })
		.input(idParamsSchema)
		.output(okSchema),
};
