import { deleteExpoFile } from "./expo-driver";
import type { keystore as Keystore } from "./keystore";
import { type OpenDeps, wipeScope } from "./open";
import { readIndex } from "./secrets";

// Removes the device engine's databases and keys that belong to nobody who is
// signed in. It runs in every build, with the engine flag on or off: a build
// that has no engine may still find the files of one that had (a dev build, an
// earlier install), and sign-out must leave none behind. This file and what it
// imports must not reach the engine package or the engine itself, so a release
// bundle that holds the sweep still holds no engine (the release bundle check
// and sweep.test.ts both look).

export type SweepDeps = Pick<OpenDeps, "secrets" | "deleteFile">;

const defaultDeps = (): SweepDeps => ({
	secrets: require("./keystore").keystore as typeof Keystore,
	deleteFile: deleteExpoFile,
});

/** Engines that are running now, by scope: what to close before their files go. */
const live = new Map<string, () => Promise<void>>();

/**
 * Tells the sweep that an engine holds this scope's file open. `dispose` must
 * close the connection and delete the file and key. Returns a function that
 * takes the entry back when the engine goes some other way.
 */
export function registerLiveEngine(
	scope: string,
	dispose: () => Promise<void>,
): () => void {
	live.set(scope, dispose);
	return () => {
		if (live.get(scope) === dispose) live.delete(scope);
	};
}

/**
 * Deletes every engine database and key except the one for `keep` (the scope
 * of the signed-in account on this server), or all of them when nobody is
 * signed in. Never throws: a scope that cannot be removed stays in the index,
 * and the next sweep tries it again.
 */
export async function sweepEngineDbs(
	keep: string | null,
	deps: SweepDeps = defaultDeps(),
): Promise<void> {
	// A running engine closes its connection before its file is deleted.
	for (const [scope, dispose] of [...live]) {
		if (scope === keep) continue;
		live.delete(scope);
		await dispose().catch(() => undefined);
	}
	let scopes: string[];
	try {
		scopes = await readIndex(deps.secrets);
	} catch {
		return;
	}
	for (const scope of scopes) {
		if (scope === keep) continue;
		await wipeScope(deps, scope).catch(() => undefined);
	}
}
