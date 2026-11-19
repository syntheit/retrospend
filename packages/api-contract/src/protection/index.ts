import * as z from "zod";
import { v1 } from "../common/meta";
import { timestampSchema } from "../core";
import {
	enableWrapSchema,
	KEY_TEXT,
	preloginKdfSchema,
	WRAP_TEXT,
} from "../keys";

const TAG = ["Advanced protection"];

export const enableProtectionSchema = z
	.object({
		currentPassword: z.string().min(1).max(255).meta({
			description:
				"The password you sign in with now, typed. Counted as a try, like a password change.",
		}),
		authKey: z.string().regex(KEY_TEXT).meta({
			description:
				"The new sign-in secret: the 32-byte auth key as base64url, 43 characters. It replaces the password for sign-in; the typed password never leaves the device again.",
		}),
		recoveryAuthKey: z.string().regex(KEY_TEXT).meta({
			description:
				"The recovery proof: the 32-byte auth key derived from the recovery key, base64url. The server stores only its SHA-256, so a later recovery proves the recovery key without the server being able to use it.",
		}),
		totpCode: z
			.string()
			.regex(/^\d{6}$/)
			.optional()
			.meta({ description: "The current two-factor code, when it is on." }),
		kdf: preloginKdfSchema,
		publicKey: z.string().regex(KEY_TEXT).meta({
			description: "The account public key, 32 bytes as base64url.",
		}),
		wraps: z.array(enableWrapSchema).length(4).meta({
			description:
				"Exactly one each of ak-password, ak-recovery and private-key, and one collection-key.",
		}),
	})
	.meta({ id: "EnableProtection" });

export const protectionKeysStatusSchema = z
	.object({
		createdAt: timestampSchema,
		version: z.int().min(1),
	})
	.meta({ id: "ProtectionKeysStatus" });

export const enableProtectionResultSchema = protectionKeysStatusSchema
	.extend({
		signedOut: z.int().min(0).meta({
			description: "How many other sessions the change signed out.",
		}),
	})
	.meta({ id: "EnableProtectionResult" });

export const protectionKeysSchema = protectionKeysStatusSchema
	.extend({ kdf: preloginKdfSchema })
	.meta({ id: "ProtectionKeys" });

export const beginPasswordRotationSchema = z
	.object({
		currentAuthKey: z.string().regex(KEY_TEXT).meta({
			description:
				"The sign-in secret you derived from your current password, base64url, 43 characters. Counted as a try, like a password change.",
		}),
	})
	.meta({ id: "BeginPasswordRotation" });

export const beginPasswordRotationResultSchema = z
	.object({
		version: z.int().min(1).meta({
			description: "The key set version to send back as baseVersion.",
		}),
		kdf: preloginKdfSchema,
		wrappedAccountKey: z.string().regex(WRAP_TEXT).meta({
			description:
				"Your account key wrapped under the current password, base64url. The server never opens it.",
		}),
	})
	.meta({ id: "BeginPasswordRotationResult" });

export const rotatePasswordSchema = z
	.object({
		currentAuthKey: z.string().regex(KEY_TEXT).meta({
			description:
				"The sign-in secret of the current password, base64url, 43 characters. Counted as a try.",
		}),
		newAuthKey: z.string().regex(KEY_TEXT).meta({
			description:
				"The sign-in secret derived from the new password and the new kdf, base64url, 43 characters.",
		}),
		kdf: preloginKdfSchema,
		wrappedAccountKey: z.string().regex(WRAP_TEXT).meta({
			description:
				"Your account key wrapped under the new password, base64url. Replaces the old wrap.",
		}),
		baseVersion: z.int().min(1).meta({
			description: "The version the begin call returned.",
		}),
	})
	.meta({ id: "RotatePassword" });

export const rotatePasswordResultSchema = z
	.object({
		version: z.int().min(2),
		signedOut: z.int().min(0).meta({
			description: "How many other sessions the change signed out.",
		}),
	})
	.meta({ id: "RotatePasswordResult" });

export type EnableProtection = z.infer<typeof enableProtectionSchema>;
export type RotatePassword = z.infer<typeof rotatePasswordSchema>;
export type ProtectionKeysDto = z.infer<typeof protectionKeysSchema>;

/**
 * Turning on Advanced protection keys (E2EE K1). Only the person's own sign-in
 * may use them (scope `account:security`), and both stay reachable once
 * protection is on. Nothing is sealed yet: the account only moves to a
 * password that never leaves the device.
 */
export const protectionContract = {
	enable: v1
		.route({
			method: "POST",
			path: "/me/protection/enable",
			operationId: "enableAdvancedProtection",
			tags: TAG,
			summary: "Create your protection keys and a new sign-in secret",
			description:
				"Needs a session made in the last 10 minutes (403 session_not_fresh), the current password (5 tries per session and 20 per account in 15 minutes, then 429), a two-factor code when it is on, and a verified email. Replaces the password with the new sign-in secret, signs out every other session, removes pending password reset links and emails you. 409 when keys already exist, 501 when the server does not offer Advanced protection.",
		})
		.meta({ scope: "account:security", event: "user.protection_keys_created" })
		.input(enableProtectionSchema)
		.output(enableProtectionResultSchema),
	keys: v1
		.route({
			method: "GET",
			path: "/me/protection/keys",
			operationId: "getProtectionKeys",
			tags: TAG,
			summary:
				"When your protection keys were made and how to derive with them",
			description:
				"The salt and Argon2id parameters to derive the sign-in secret from your password while signed in. 404 when you have no keys.",
		})
		.meta({ scope: "account:security" })
		.output(protectionKeysSchema),
	beginPasswordRotation: v1
		.route({
			method: "POST",
			path: "/me/protection/password/begin",
			operationId: "beginPasswordRotation",
			tags: TAG,
			summary: "Prove your current sign-in secret and get your password wrap",
			description:
				"Step one of changing the password of an account with protection keys. The wrap is released only to a caller that proves the current sign-in secret (5 tries per session and 20 per account in 15 minutes, shared with every password check, then 429; a wrong one is 400 wrong_password). 409 when you have no keys, 501 when the server does not offer Advanced protection. Writes nothing, so it needs no Idempotency-Key.",
		})
		.meta({ scope: "account:security", readsOnly: true })
		.input(beginPasswordRotationSchema)
		.output(beginPasswordRotationResultSchema),
	rotatePassword: v1
		.route({
			method: "POST",
			path: "/me/protection/password",
			operationId: "rotatePassword",
			tags: TAG,
			summary: "Change the password of an account with protection keys",
			description:
				"Step two: the device derived a new sign-in secret and rewrapped the account key under the new password. Counts a try like step one. Replaces the stored sign-in secret and the password wrap together, signs out every other session, removes pending password reset links and emails you. 409 when the keys changed since step one: start again from step one. 501 when the server does not offer Advanced protection.",
		})
		.meta({ scope: "account:security", event: "user.password_changed" })
		.input(rotatePasswordSchema)
		.output(rotatePasswordResultSchema),
};
