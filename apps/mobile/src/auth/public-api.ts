// The signed-out half of API v1 the recovery flow needs: the public auth
// routes (reset code, recovery check, begin and commit), which take no
// session. Its own file so the recovery helpers and their jest tests never
// load the client's ES-module dependencies.
import { createRetrospendClient } from "@retrospend/api-client";
import { newClientId } from "@/data/ids";
import type { RecoveryApi } from "./recovery";

export function publicAuthApi(baseUrl: string): RecoveryApi {
	return createRetrospendClient({ baseUrl, newIdempotencyKey: newClientId })
		.auth;
}
