import * as z from "zod";
import { v1 } from "../common/meta";

const TAG = ["Auth"];

export const preloginSchema = z
	.object({
		email: z.email().max(255),
	})
	.meta({ id: "Prelogin" });

/** What a client needs to turn a typed password into the sign-in secret. */
export const preloginKdfSchema = z
	.object({
		salt: z
			.string()
			.regex(/^[A-Za-z0-9_-]{22}$/)
			.meta({ description: "The 16-byte Argon2id salt, base64url." }),
		memoryKiB: z.int().min(1),
		passes: z.int().min(1),
	})
	.meta({ id: "PreloginKdf" });

export const preloginResultSchema = z
	.object({
		kdf: preloginKdfSchema.nullable().meta({
			description:
				"Null for an account without Advanced protection keys and for an address with no account: the typed password is the sign-in secret. Otherwise the client derives the sign-in secret with Argon2id from the password and these values.",
		}),
	})
	.meta({ id: "PreloginResult" });

export type PreloginKdf = z.infer<typeof preloginKdfSchema>;
export type PreloginResult = z.infer<typeof preloginResultSchema>;

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
};
