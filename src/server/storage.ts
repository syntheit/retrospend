import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readdir } from "node:fs/promises";
import { env } from "~/env";

const UPLOAD_DIR = env.UPLOAD_DIR;

async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

export async function uploadFile(
	path: string,
	buffer: Buffer,
	_contentType: string,
): Promise<string> {
	const fullPath = join(UPLOAD_DIR, path);
	await ensureDir(dirname(fullPath));

	// Atomic write: write to temp file, then rename
	const tmpPath = `${fullPath}.tmp.${Date.now()}`;
	try {
		const readable = Readable.from(buffer);
		const writable = createWriteStream(tmpPath);
		await pipeline(readable, writable);
		await rename(tmpPath, fullPath);
	} catch (err) {
		// Clean up temp file on failure
		await rm(tmpPath, { force: true }).catch(() => {});
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to upload file: ${message}`);
	}

	return path;
}

/**
 * Deletes one stored file. The path must name a file inside UPLOAD_DIR:
 * paths come from database rows, and a row a client could shape (an
 * idempotency key, say) must never reach a file outside it.
 */
export async function deleteFile(path: string): Promise<void> {
	const fullPath = join(UPLOAD_DIR, path);
	const inside = relative(UPLOAD_DIR, fullPath);
	if (
		inside === "" ||
		inside === ".." ||
		inside.startsWith(`..${sep}`) ||
		isAbsolute(inside)
	)
		throw new Error("Failed to delete file: outside the upload directory");
	try {
		await rm(fullPath, { force: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to delete file: ${message}`);
	}
}

export async function getFileStream(
	path: string,
): Promise<NodeJS.ReadableStream> {
	const fullPath = join(UPLOAD_DIR, path);
	// Verify the file exists before creating a stream, createReadStream
	// doesn't throw until you try to read, which causes unhandled errors.
	await access(fullPath);
	return createReadStream(fullPath);
}

export async function getStorageSize(): Promise<number> {
	return getDirectorySize(UPLOAD_DIR);
}

async function getDirectorySize(dir: string): Promise<number> {
	let total = 0;
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				total += await getDirectorySize(entryPath);
			} else {
				const s = await stat(entryPath);
				total += s.size;
			}
		}
	} catch {
		// Directory doesn't exist yet, size is 0
	}
	return total;
}

export { getImageUrl } from "~/lib/image-url";
