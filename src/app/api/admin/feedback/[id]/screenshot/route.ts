import { Readable } from "node:stream";
import { getWebSession } from "~/server/better-auth/web-session";
import { openFeedbackScreenshotAsAdmin } from "~/server/services/feedback-screenshot.service";

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
	const stream = await openFeedbackScreenshotAsAdmin(session.user.id, id);
	if (!stream) return new Response("Not found", { status: 404 });
	return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
		headers: {
			"Content-Type": "image/webp",
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Disposition": "inline",
		},
	});
}
