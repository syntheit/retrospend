import { randomBytes } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { env } from "~/env";

/**
 * Where finished API exports live. A store of its own, never under
 * UPLOAD_DIR: /api/images serves that directory to anyone without signing
 * in, and an export holds a person's whole ledger. Nothing here is served by
 * path; a file is read only through its export_job row, by its owner.
 */

function root(): string {
	const dir = resolve(env.EXPORT_DIR ?? join(tmpdir(), "retrospend-exports"));
	const uploads = resolve(env.UPLOAD_DIR);
	const inside = relative(uploads, dir);
	const outside =
		inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
	if (!outside) throw new Error("EXPORT_DIR must not be inside UPLOAD_DIR");
	return dir;
}

/** A path nobody can guess from the job id: `<userId>/<random>/<jobId>`. */
export function newExportPath(userId: string, jobId: string): string {
	return `${userId}/${randomBytes(16).toString("hex")}/${jobId}`;
}

function fullPath(path: string): string {
	const base = root();
	const full = resolve(base, path);
	if (!full.startsWith(base + sep)) throw new Error("Invalid export path");
	return full;
}

export async function putExport(path: string, bytes: Buffer): Promise<void> {
	const full = fullPath(path);
	await mkdir(dirname(full), { recursive: true });
	const tmp = `${full}.tmp.${Date.now()}`;
	try {
		await writeFile(tmp, bytes);
		await rename(tmp, full);
	} catch (error) {
		await rm(tmp, { force: true }).catch(() => {});
		throw error;
	}
}

/** The file as a lazy, file-backed Blob: its bytes are read as the response is sent. */
export async function openExport(path: string): Promise<Blob> {
	const full = fullPath(path);
	await stat(full);
	return openAsBlob(full);
}

/** Removes one file and the random folder around it. */
export async function removeExport(path: string): Promise<void> {
	await rm(dirname(fullPath(path)), { recursive: true, force: true });
}

/** Removes everything a user ever exported (account deletion). */
export async function removeUserExports(userId: string): Promise<void> {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return;
	await rm(fullPath(userId), { recursive: true, force: true });
}
