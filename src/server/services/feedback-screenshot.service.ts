import { db } from "~/server/db";
import { getFileStream } from "~/server/storage";

/**
 * The stored screenshot of a feedback entry, or null when the entry has none
 * or the file is gone. The path comes from the entry, never from the caller,
 * and callers must have checked the person is an admin.
 */
export async function openFeedbackScreenshot(
	id: string,
): Promise<NodeJS.ReadableStream | null> {
	const row = await db.feedback.findUnique({
		where: { id },
		select: { screenshotPath: true },
	});
	if (!row?.screenshotPath) return null;
	try {
		return await getFileStream(row.screenshotPath);
	} catch {
		return null;
	}
}
