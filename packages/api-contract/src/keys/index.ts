// The shapes of key material on the wire, written once. Every route that
// carries a sign-in secret, a public key, a wrap or the kdf parameters imports
// them from here; none of them may write these patterns again.
import * as z from "zod";

/** 32 bytes as unpadded base64url (the sign-in secret, a public key). */
export const KEY_TEXT = /^[A-Za-z0-9_-]{43}$/;

/** The wrap text of a symmetric wrap; the server checks the bytes. */
export const WRAP_TEXT = /^[A-Za-z0-9_-]{1,512}$/;

/** A collection key id: 16 bytes as lowercase hex (pinned to @retrospend/crypto by a server test). */
export const KEY_ID_HEX = /^[0-9a-f]{32}$/;

/** The roles of the four wraps a new key set starts with. */
export const ENABLE_WRAP_ROLES = [
	"ak-password",
	"ak-recovery",
	"private-key",
	"collection-key",
] as const;

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

export type PreloginKdf = z.infer<typeof preloginKdfSchema>;

export const enableWrapSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id for the wrap; the server makes one when absent.",
		}),
		role: z.enum(ENABLE_WRAP_ROLES),
		targetId: z
			.string()
			.regex(/^[A-Za-z0-9_-]{1,64}$/)
			.meta({
				description:
					"What the wrap is bound to: your user id for ak-password, ak-recovery and private-key; for collection-key, the lowercase hex of the 16-byte key id (32 characters).",
			}),
		wrapped: z.string().regex(WRAP_TEXT).meta({
			description: "The wrapped key, base64url. The server never opens it.",
		}),
	})
	.refine(
		(wrap) => wrap.role !== "collection-key" || KEY_ID_HEX.test(wrap.targetId),
		{
			path: ["targetId"],
			message: "A collection key is named by the lowercase hex of its key id.",
		},
	)
	.meta({ id: "EnableProtectionWrap" });
