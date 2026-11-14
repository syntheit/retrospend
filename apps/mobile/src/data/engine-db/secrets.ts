import { ENGINE_INDEX_NAME, engineKeyName, isEngineScope } from "./names";

// The engine database key lives in the platform keystore (keystore.ts), per
// account and server, with the bearer token's accessibility class: this device
// only, never in a backup. The index lists every scope that may hold a file or a key:
// a scope is added before either exists, so a sweep can always find them.

export interface SecretStore {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
}

/** Where the bytes come from. Must be a platform secure generator; there is no fallback. */
export type RandomBytes = (count: number) => Promise<Uint8Array>;

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** The key saved for a scope, or null when there is none or it is not a key. */
export async function readKey(
	secrets: SecretStore,
	scope: string,
): Promise<string | null> {
	const saved = await secrets.get(engineKeyName(scope));
	return saved !== null && KEY_PATTERN.test(saved) ? saved : null;
}

/**
 * Makes a new key and saves it, replacing any other, then reads it back: a
 * keystore that does not keep it would leave a file nobody can open. Throws
 * when the generator gives anything but 32 bytes that are not all zero (a
 * stuck generator) or the keystore does not hold the key.
 */
export async function createKey(
	secrets: SecretStore,
	random: RandomBytes,
	scope: string,
): Promise<string> {
	const bytes = await random(KEY_BYTES);
	if (bytes.length !== KEY_BYTES || bytes.every((b) => b === 0))
		throw new Error("The random generator gave no usable key");
	const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	await secrets.set(engineKeyName(scope), key);
	if ((await secrets.get(engineKeyName(scope))) !== key)
		throw new Error("The keystore did not keep the key");
	return key;
}

export const deleteKey = (secrets: SecretStore, scope: string) =>
	secrets.delete(engineKeyName(scope));

// Index changes read, change and write one value, so they run one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(work: () => Promise<T>): Promise<T> => {
	const run = queue.then(work, work);
	queue = run.catch(() => undefined);
	return run;
};

/** The scopes in the index; text that is not a list of scopes reads as empty. */
export async function readIndex(secrets: SecretStore): Promise<string[]> {
	const saved = await secrets.get(ENGINE_INDEX_NAME);
	if (saved === null) return [];
	try {
		const parsed: unknown = JSON.parse(saved);
		return Array.isArray(parsed) ? parsed.filter(isEngineScope) : [];
	} catch {
		return [];
	}
}

const changeIndex = (
	secrets: SecretStore,
	change: (scopes: string[]) => string[],
) =>
	serialized(async () => {
		const before = await readIndex(secrets);
		const after = change(before);
		if (after.length !== before.length)
			await secrets.set(ENGINE_INDEX_NAME, JSON.stringify(after));
	});

export const addToIndex = (secrets: SecretStore, scope: string) =>
	changeIndex(secrets, (all) => (all.includes(scope) ? all : [...all, scope]));

export const removeFromIndex = (secrets: SecretStore, scope: string) =>
	changeIndex(secrets, (all) => all.filter((s) => s !== scope));
