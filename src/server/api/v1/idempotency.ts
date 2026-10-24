import { os } from "@orpc/server";
import {
	type ApiMeta,
	IDEMPOTENCY_HEADER,
	IDEMPOTENT_REPLAYED_HEADER,
	isValidIdempotencyKey,
	isWriteMethod,
} from "@retrospend/api-contract/common";
import {
	completeIdempotentRequest,
	hashRequest,
	releaseIdempotentRequest,
	startIdempotentRequest,
} from "~/server/services/api-v1/idempotency.service";
import { problem } from "./errors";
import type { V1Context } from "./middleware";

/**
 * Every write needs an Idempotency-Key (conventions in
 * packages/api-contract/src/common/idempotency.ts). The first successful
 * response is stored and replayed; a handler failure frees the key. Keys
 * are per user (RLS on idempotency_key): two users never collide, and one
 * user's key never replays another user's response. The request is
 * fingerprinted by method, route and raw input, so reusing a key for a
 * different request is refused instead of replaying the wrong response.
 */
export const idempotency = os
	.$context<V1Context>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next, procedure }, input, output) => {
		const route = procedure["~orpc"].route;
		const method = (route.method ?? "POST").toUpperCase();
		const user = context.user;
		// A preview twin writes nothing (it rolls back), so it needs no key and
		// one key can preview and then write.
		if (!isWriteMethod(method) || !user || procedure["~orpc"].meta.previewOf)
			return next();

		const key = context.headers.get(IDEMPOTENCY_HEADER);
		if (!key) throw problem("idempotency_key_required");
		if (!isValidIdempotencyKey(key))
			throw problem(
				"bad_request",
				"Idempotency-Key must be 1 to 255 printable characters",
			);

		const start = await startIdempotentRequest(user.db, {
			userId: user.principal.userId,
			key,
			requestHash: await hashRequest(method, route.path ?? "", input),
		});
		switch (start.kind) {
			case "reused":
				throw problem("idempotency_key_reused");
			case "in_progress":
				throw problem("idempotency_in_progress");
			case "replay_unavailable":
				throw problem("idempotency_replay_unavailable");
			case "replay":
				context.resHeaders?.set(IDEMPOTENT_REPLAYED_HEADER, "true");
				return output(start.body as never);
		}

		let result: Awaited<ReturnType<typeof next>>;
		try {
			result = await next();
		} catch (error) {
			// The handler failed, so nothing committed: free the key for a retry.
			await releaseIdempotentRequest(user.db, start.id).catch(() => undefined);
			throw error;
		}
		// The write committed. If storing the response fails the key stays in
		// progress until it expires, which refuses retries instead of writing
		// twice.
		const meta = procedure["~orpc"].meta;
		await completeIdempotentRequest(
			user.db,
			start.id,
			route.successStatus ?? 200,
			meta.secretResponse ? undefined : result.output,
		);
		return result;
	});
