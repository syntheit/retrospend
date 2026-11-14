import { failureKind, type SqlDriver } from "./driver";
import { engineFileName } from "./names";
import {
	addToIndex,
	createKey,
	deleteKey,
	type RandomBytes,
	readKey,
	removeFromIndex,
	type SecretStore,
} from "./secrets";

// Opening the engine database. The file is SQLCipher ciphertext, or there is
// no file: every way this can go wrong ends in no file and a memory-only
// engine, never in a file written without a key.

export interface OpenDeps {
	secrets: SecretStore;
	random: RandomBytes;
	/** Opens a connection to the named file, creating it when absent; throws when it cannot. */
	openFile(name: string): SqlDriver;
	/** Deletes the file and its journal files. Never throws; a missing file is fine. */
	deleteFile(name: string): void;
	/** Codes only: no row, amount, name or key may reach it. */
	log(what: string, code?: string): void;
}

/** Removes a scope's file, key and index entry. Each step runs whatever the others did. */
export async function wipeScope(
	deps: Pick<OpenDeps, "secrets" | "deleteFile">,
	scope: string,
): Promise<void> {
	deps.deleteFile(engineFileName(scope));
	// The index entry goes last: while it stays, a failed key delete is found again.
	await deleteKey(deps.secrets, scope).then(() =>
		removeFromIndex(deps.secrets, scope),
	);
}

/** The first value of a row, the way SQLCipher answers `PRAGMA cipher_version`. */
function cipherVersion(driver: SqlDriver): string | null {
	const row = driver.all<Record<string, unknown>>("PRAGMA cipher_version")[0];
	const value = row ? Object.values(row)[0] : undefined;
	return typeof value === "string" && value.length > 0 ? value : null;
}

function closeQuietly(driver: SqlDriver) {
	try {
		driver.close();
	} catch {
		// Nothing left to do with a connection that will not close.
	}
}

/** Keys the connection and proves the file opens with it. Throws what the file throws. */
function unlock(driver: SqlDriver, key: string): "ready" | "no-cipher" {
	// The key is the first statement: nothing else may touch the file before it.
	driver.exec(`PRAGMA key = "x'${key}'"`);
	// A build without SQLCipher ignores the pragma and would write plaintext.
	if (cipherVersion(driver) === null) return "no-cipher";
	// A wrong key or a file that is not ours fails here, at the first read.
	driver.all("SELECT count(*) FROM sqlite_master");
	driver.exec("PRAGMA temp_store = MEMORY");
	return "ready";
}

/**
 * The keyed connection for a scope, or null for a memory-only engine: no
 * secure generator, no keystore, no SQLCipher in this build, or a file that
 * cannot be opened. A file with no key, or one the key does not open, is
 * deleted and made again under a new key.
 */
export async function openEncrypted(
	deps: OpenDeps,
	scope: string,
): Promise<SqlDriver | null> {
	const file = engineFileName(scope);
	try {
		// Listed before the key or the file exist, so a sweep finds both.
		await addToIndex(deps.secrets, scope);
		let key = await readKey(deps.secrets, scope);
		if (key === null) {
			// A file whose key is gone cannot be read by anyone.
			deps.deleteFile(file);
			key = await createKey(deps.secrets, deps.random, scope);
		}
		for (let attempt = 0; attempt < 2; attempt++) {
			const driver = deps.openFile(file);
			try {
				if (unlock(driver, key) === "ready") return driver;
				closeQuietly(driver);
				deps.log("database has no cipher, running without one");
				await wipeScope(deps, scope);
				return null;
			} catch (error) {
				closeQuietly(driver);
				if (failureKind(error) !== "notadb") throw error;
				deps.log("database did not open with its key, starting empty");
				deps.deleteFile(file);
				key = await createKey(deps.secrets, deps.random, scope);
			}
		}
		// A fresh file under a fresh key still failed: leave nothing behind.
		await wipeScope(deps, scope);
		return null;
	} catch (error) {
		deps.log("database unavailable, running without one", failureKind(error));
		return null;
	}
}
