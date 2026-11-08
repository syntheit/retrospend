import { db } from "~/server/db";
import { recordAdminRead } from "~/server/services/admin-access.service";
import { getFileStream } from "~/server/storage";

/**
 * The stored screenshot of a feedback entry as an admin reads it, or null when
 * the entry has none or the file is gone. The path comes from the entry, never
 * from the caller, and callers must have checked the person is an admin. The
 * read is written to the sender's admin access log once the file has opened
 * and before it is handed back: a missing picture writes nothing, and if the
 * entry cannot be written the picture is not served.
 */
export async function openFeedbackScreenshotAsAdmin(
	adminId: string,
	id: string,
): Promise<NodeJS.ReadableStream | null> {
	const row = await db.feedback.findUnique({
		where: { id },
		select: { screenshotPath: true, userId: true },
	});
	if (!row?.screenshotPath) return null;
	let stream: NodeJS.ReadableStream;
	try {
		stream = await getFileStream(row.screenshotPath);
	} catch {
		return null;
	}
	try {
		await recordAdminRead(db, {
			adminId,
			userId: row.userId,
			action: "feedback_screenshot_viewed",
		});
	} catch (error) {
		(stream as { destroy?: () => void }).destroy?.();
		throw error;
	}
	return stream;
}
