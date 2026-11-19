import * as z from "zod";
import { v1 } from "../common/meta";
import {
	KEY_TEXT,
	preloginKdfSchema,
	RECOVERY_WRAP_ROLES,
	WRAP_TEXT,
} from "../keys";

const TAG = ["Auth"];

export const preloginSchema = z
	.object({
		email: z.email().max(255),
	})
	.meta({ id: "Prelogin" });

export const preloginResultSchema = z
	.object({
		kdf: preloginKdfSchema.nullable().meta({
			description:
				"Null for an account without Advanced protection keys and for an address with no account: the typed password is the sign-in secret. Otherwise the client derives the sign-in secret with Argon2id from the password and these values.",
		}),
	})
	.meta({ id: "PreloginResult" });

export type PreloginResult = z.infer<typeof preloginResultSchema>;

const resetToken = z.string().min(1).max(256).meta({
	description:
		"The token from the reset link in the email. An unknown, expired, used or admin-made token is 404 invalid_token.",
});

const recoveryAuthKey = z.string().regex(KEY_TEXT).meta({
	description:
		"The recovery proof: the 32-byte auth key derived from the recovery key, base64url, 43 characters. Counted as a recovery try.",
});

export const checkRecoverySchema = z
	.object({ token: resetToken })
	.meta({ id: "CheckRecovery" });

export const checkRecoveryResultSchema = z
	.object({
		keys: z.enum(["none", "recovery", "noRecovery"]).meta({
			description:
				"none: the account has no protection keys, so the plain reset applies. recovery: a recovery key can set a new password. noRecovery: keys made before the recovery proof existed, so no recovery key can be checked.",
		}),
		protectionOn: z.boolean().meta({
			description: "Whether Advanced protection is on for the account.",
		}),
	})
	.meta({ id: "CheckRecoveryResult" });

export const beginRecoverySchema = z
	.object({ token: resetToken, recoveryAuthKey })
	.meta({ id: "BeginRecovery" });

export const recoveryWrapSchema = z
	.object({
		role: z.enum(RECOVERY_WRAP_ROLES),
		targetId: z.string().min(1).max(64).meta({
			description: "What the wrap is bound to: your user id.",
		}),
		wrapped: z.string().regex(WRAP_TEXT).meta({
			description: "The wrapped key, base64url. The server never opens it.",
		}),
	})
	.meta({ id: "RecoveryWrap" });

export const beginRecoveryResultSchema = z
	.object({
		userId: z.string().min(1).max(64).meta({
			description: "The account the link opens recovery for.",
		}),
		version: z.int().min(1).meta({
			description: "The key set version to send back as baseVersion.",
		}),
		publicKey: z.string().regex(KEY_TEXT).meta({
			description: "The account public key, 32 bytes as base64url.",
		}),
		wraps: z.array(recoveryWrapSchema).meta({
			description:
				"Your ak-recovery and private-key wraps, and nothing else. The password wrap never leaves through this route.",
		}),
	})
	.meta({ id: "BeginRecoveryResult" });

export const recoverSchema = z
	.object({
		token: resetToken,
		recoveryAuthKey,
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
	.meta({ id: "Recover" });

export const recoverResultSchema = z
	.object({
		version: z.int().min(2),
		signedOut: z.int().min(0).meta({
			description: "How many sessions the change signed out (all of them).",
		}),
	})
	.meta({ id: "RecoverResult" });

export type CheckRecoveryResult = z.infer<typeof checkRecoveryResultSchema>;
export type BeginRecovery = z.infer<typeof beginRecoverySchema>;
export type BeginRecoveryResult = z.infer<typeof beginRecoveryResultSchema>;
export type Recover = z.infer<typeof recoverSchema>;
export type RecoverResult = z.infer<typeof recoverResultSchema>;

export const authContract = {
	prelogin: v1
		.route({
			method: "POST",
			path: "/auth/prelogin",
			operationId: "prelogin",
			tags: TAG,
			summary: "How to turn a password into the sign-in secret",
			description:
				"Public, and answered the same way with or without credentials. Call it before signing in. It reveals that an address has Advanced protection keys; it does not say whether an address has an account. Writes nothing, so it needs no Idempotency-Key.",
		})
		.meta({ scope: "public", readsOnly: true })
		.input(preloginSchema)
		.output(preloginResultSchema),

	checkRecovery: v1
		.route({
			method: "POST",
			path: "/auth/recovery/check",
			operationId: "checkRecovery",
			tags: TAG,
			summary: "What a password reset link leads to",
			description:
				"Public. Call it with the token from the reset email before showing the reset page. Spends no try and releases no key. 404 invalid_token for an unknown, expired, used or admin-made token. Limited per address (10 a minute, shared with begin and the recovery itself). Writes nothing, so it needs no Idempotency-Key.",
		})
		.meta({ scope: "public", readsOnly: true })
		.input(checkRecoverySchema)
		.output(checkRecoveryResultSchema),
	beginRecovery: v1
		.route({
			method: "POST",
			path: "/auth/recovery/begin",
			operationId: "beginRecovery",
			tags: TAG,
			summary: "Prove your recovery key and get the wraps it opens",
			description:
				"Public. The ak-recovery and private-key wraps are released to a caller that holds a live reset link and proves the recovery key. Each call counts one recovery try (5 per link and 10 per account in an hour, then 429). 404 invalid_token for an unknown, expired, used or admin-made token, and 404 when the account has no keys. 400 wrong_recovery_key for a wrong proof. 409 recovery_unavailable when the keys were made before the recovery proof existed. Writes nothing, so it needs no Idempotency-Key.",
		})
		.meta({ scope: "public", readsOnly: true })
		.input(beginRecoverySchema)
		.output(beginRecoveryResultSchema),
	recover: v1
		.route({
			method: "POST",
			path: "/auth/recovery",
			operationId: "recoverAccount",
			tags: TAG,
			summary: "Set a new password with your recovery key",
			description:
				"Public. Checks the reset link and the recovery proof again, spends the link, sets the new password and its key wrap, signs out every session, deletes the account's API keys and emails you. Counts one recovery try. The link works once, so there is no Idempotency-Key: a retry after a lost answer is 404 invalid_token, and the person signs in. 400 wrong_recovery_key for a wrong proof; 404 invalid_token for an unknown, expired, used or admin-made token; 409 conflict when the keys changed since begin (start again) and 409 recovery_unavailable as for begin; 429 when the tries or the address limit are used up. Two-factor is not skipped: signing in afterward still asks for it.",
		})
		.meta({ scope: "public", publicWrite: "resetToken" })
		.input(recoverSchema)
		.output(recoverResultSchema),
};
