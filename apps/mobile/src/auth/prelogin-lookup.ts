// The signed-out half of the KDF lookup: POST /api/v1/auth/prelogin through the
// typed client. Its own file so the helper (and its jest tests) never load the
// client's ES-module dependencies.
import { createRetrospendClient } from "@retrospend/api-client";
import { newClientId } from "@/data/ids";
import type { KdfLookup } from "./sign-in-secret";

/** The server's answer, unread (the shared core reads it); a thrown error carries its HTTP status. */
export function preloginLookup(baseUrl: string, email: string): KdfLookup {
	return {
		route: "prelogin",
		ask: () =>
			createRetrospendClient({
				baseUrl,
				newIdempotencyKey: newClientId,
			}).auth.prelogin({ email }),
	};
}
