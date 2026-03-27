import { Readable } from "node:stream";
import { getFileStream } from "~/server/storage";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const { path: pathSegments } = await params;
	const filePath = pathSegments.join("/");

	// Path validation - security-critical
	// Only allow: alphanumeric, hyphens, underscores, dots, forward slashes
	if (
		!filePath ||
		/[^a-zA-Z0-9\-_./]/.test(filePath) ||
		filePath.includes("..") ||
		filePath.startsWith("/") ||
		filePath.includes("//")
	) {
		return new Response("Not found", { status: 404 });
	}

	try {
		const nodeStream = await getFileStream(filePath);

		let contentType = "application/octet-stream";
		if (filePath.endsWith(".webp")) contentType = "image/webp";
		else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
			contentType = "image/jpeg";
		else if (filePath.endsWith(".png")) contentType = "image/png";

		const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;

		return new Response(webStream, {
			headers: {
				"Content-Type": contentType,
				// immutable: the filename contains a timestamp, so a new upload = new URL.
				// Cloudflare and browsers can cache indefinitely.
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
}
