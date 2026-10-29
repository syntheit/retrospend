import { Directory, File, Paths } from "expo-file-system";

// Exported files are personal data, so the phone keeps none of them: each
// one lives in its own cache folder only until the share sheet closes, and
// the folder is swept at launch and at sign-out in case the app stopped in
// between.

const FOLDER = "exports";

function exportsDir(): Directory {
	return new Directory(Paths.cache, FOLDER);
}

/** A file in the export folder, which is made when missing. */
export function exportFile(name: string): File {
	const dir = exportsDir();
	if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
	return new File(dir, name);
}

/** Deletes a file if it is there; a failure leaves it to the next sweep. */
export function removeFile(file: File): void {
	try {
		if (file.exists) file.delete();
	} catch {
		// The next sweep removes it.
	}
}

/** Removes the export folder and everything in it. Never throws. */
export function sweepExports(): void {
	try {
		const dir = exportsDir();
		if (dir.exists) dir.delete();
	} catch {
		// Nothing to do: the system clears the cache folder too.
	}
}

/** Shares the file, then deletes it once the share sheet has closed. */
export async function shareThenDelete(
	file: File,
	share: (file: File) => Promise<void>,
): Promise<void> {
	try {
		await share(file);
	} finally {
		removeFile(file);
	}
}
