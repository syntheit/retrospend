import { Readable } from "node:stream";
import { getWebSession } from "~/server/better-auth/web-session";
import { db } from "~/server/db";
import { getFileStream } from "~/server/storage";

/**
 * A feedback screenshot for the admin inbox. It can show a person's screen,
 * so it is never a public URL: the path is read from the entry (not from the
 * request), the caller must be a signed-in admin on a web session, and the
 * answer is never kept by a shared cache.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await getWebSession(request.headers);
	if (!session) return new Response("Unauthorized", { status: 401 });
	if ((session.user as { role?: string }).role !== "ADMIN")
		return new Response("Forbidden", { status: 403 });

	const { id } = await params;
	const row = await db.feedback.findUnique({
		where: { id },
		select: { screenshotPath: true },
	});
	if (!row?.screenshotPath) return new Response("Not found", { status: 404 });

	try {
		const stream = await getFileStream(row.screenshotPath);
		return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
			headers: {
				"Content-Type": "image/webp",
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
				"Content-Disposition": "inline",
			},
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
}
