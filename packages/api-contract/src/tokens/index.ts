import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { scopeSchema } from "../common/scopes";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_MAX_DAYS = 365;

/** A personal access token as listed. The key itself is shown once, at creation. */
export const accessTokenSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		/** The first characters of the key ("rsk_AbCd"), to recognize it. */
		start: z.string().nullable(),
		scopes: z.array(scopeSchema),
		enabled: z.boolean(),
		createdAt: timestampSchema,
		expiresAt: timestampSchema.nullable(),
		lastUsedAt: timestampSchema.nullable(),
	})
	.meta({ id: "AccessToken" });

export type AccessTokenDto = z.infer<typeof accessTokenSchema>;

export const createAccessTokenSchema = z
	.object({
		name: z.string().trim().min(1).max(64),
		scopes: z.array(scopeSchema).min(1),
		expiresInDays: z
			.int()
			.min(1)
			.max(TOKEN_MAX_DAYS)
			.default(TOKEN_DEFAULT_DAYS),
	})
	.meta({ id: "CreateAccessToken" });

export const createdAccessTokenSchema = z
	.object({
		token: accessTokenSchema,
		/** The key, shown this once. Send it as `x-api-key` or a bearer. */
		key: z.string(),
	})
	.meta({ id: "CreatedAccessToken" });

const TAG = ["Tokens"];

export const tokensContract = {
	list: v1
		.route({
			method: "GET",
			path: "/tokens",
			operationId: "listAccessTokens",
			tags: TAG,
			summary: "The caller's personal access tokens, newest first",
			description:
				"Only from the web app's own session (Settings > Developer); any other credential gets forbidden.",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(accessTokenSchema)),
	create: v1
		.route({
			method: "POST",
			path: "/tokens",
			operationId: "createAccessToken",
			tags: TAG,
			summary: "Create a personal access token",
			description:
				"Only from the web app's own session (Settings > Developer), and never with a scope the caller lacks. The key is in this response only; a replayed Idempotency-Key answers idempotency_replay_unavailable.",
			successStatus: 201,
		})
		.meta({
			scope: "write:settings",
			event: "token.created",
			secretResponse: true,
		})
		.input(createAccessTokenSchema)
		.output(createdAccessTokenSchema),
	revoke: v1
		.route({
			method: "DELETE",
			path: "/tokens/{id}",
			operationId: "revokeAccessToken",
			tags: TAG,
			summary: "Revoke a personal access token",
		})
		.meta({ scope: "write:settings", event: "token.revoked" })
		.input(idParamsSchema)
		.output(okSchema),
};
