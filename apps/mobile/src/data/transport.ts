import type { RetrospendClient } from "@retrospend/api-client";
import { apiTransport, type Transport } from "@/features/entry/send";

/**
 * Where an account's writes go: the one place that chooses. Every save, flush,
 * undo and Try again takes its transport from here, and the sealed vault (K9)
 * switches for a protected account here and nowhere else. Today it is API v1.
 */
export function transportFor(api: RetrospendClient): Transport {
	return apiTransport(api);
}
