import { originOf, sha256Hex } from "@/lib/origin-key";

// What one account on one server calls its engine database and key. Both
// names carry a hash of the server's origin and the account id, never the id
// itself, so a file listing or a keystore listing says nothing about who the
// account is. Nothing here imports the engine: the sweep (sweep.ts) uses it
// in builds that have no engine.

const SCOPE_PATTERN = /^[0-9a-f]{32}$/;

export function engineScope(baseUrl: string, userId: string): string {
	return sha256Hex(`${originOf(baseUrl)}|${userId}`).slice(0, 32);
}

export const isEngineScope = (value: unknown): value is string =>
	typeof value === "string" && SCOPE_PATTERN.test(value);

export const engineFileName = (scope: string) =>
	`retrospend-engine-${scope}.db`;

/** A keystore name: letters, digits, dots, dashes and underscores only. */
export const engineKeyName = (scope: string) =>
	`retrospend.engine.key.${scope}`;

/** The scopes that may have a file or a key, so a sweep finds them without listing the keystore. */
export const ENGINE_INDEX_NAME = "retrospend.engine.index";
