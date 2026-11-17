import type { EngineStorage, StorageHooks } from "@retrospend/engine/device";
import { failureKind } from "./driver";
import { type OpenDeps, openEncrypted, wipeScope } from "./open";
import { createPersistence, type LoadedEngine, loadEngineDb } from "./persist";

// One account's disk copy as the device engine sees it (the EngineStorage
// port in @retrospend/engine/device): what was on disk, the writer for the
// engine's store, and a way to close it and, when the account goes, to delete
// the file and the key.

/** Opens the encrypted file for a scope and reads it, or null for a memory-only engine. */
export async function openEngineStorage(
	deps: OpenDeps,
	scope: string,
	hooks: StorageHooks,
): Promise<EngineStorage | null> {
	const driver = await openEncrypted(deps, scope);
	if (driver === null) return null;
	let loaded: LoadedEngine;
	try {
		loaded = loadEngineDb(driver, scope);
	} catch (error) {
		deps.log("database unreadable, running without one", failureKind(error));
		try {
			driver.close();
		} catch {
			// Deleted next.
		}
		await wipeScope(deps, scope).catch(() => undefined);
		return null;
	}
	if (loaded.wiped) deps.log("database did not match, started empty");
	const persistence = createPersistence(driver, loaded, hooks);
	return {
		loaded,
		persistence,
		async dispose({ wipe }) {
			persistence.close();
			if (wipe) await wipeScope(deps, scope);
		},
	};
}
