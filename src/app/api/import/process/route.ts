import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/better-auth";

export async function POST(request: NextRequest) {
	// Validate session
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Check importer is configured
	const importerUrl = env.IMPORTER_URL;
	if (!importerUrl) {
		return NextResponse.json(
			{ error: "Bank statement import is not configured on this instance" },
			{ status: 503 },
		);
	}

	// Check API key is available
	const apiKey = env.WORKER_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "Importer authentication is not configured" },
			{ status: 503 },
		);
	}

	// Read the multipart form data
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return NextResponse.json(
			{ error: "Invalid form data. Please upload a file." },
			{ status: 400 },
		);
	}

	const file = formData.get("file");
	if (!file || !(file instanceof File)) {
		return NextResponse.json(
			{ error: "No file provided. Please upload a CSV or PDF file." },
			{ status: 400 },
		);
	}

	// Validate file type
	const name = file.name.toLowerCase();
	if (!name.endsWith(".csv") && !name.endsWith(".pdf")) {
		return NextResponse.json(
			{ error: "Unsupported file type. Please upload a CSV or PDF file." },
			{ status: 422 },
		);
	}

	// Forward to the Go importer
	const importerFormData = new FormData();
	importerFormData.append("file", file);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes

	try {
		const response = await fetch(`${importerUrl}/process`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			body: importerFormData,
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");

			if (response.status === 409) {
				return NextResponse.json(
					{ error: "This file has already been imported." },
					{ status: 409 },
				);
			}

			if (response.status === 422) {
				return NextResponse.json(
					{
						error: `Could not parse the file: ${errorText}`,
					},
					{ status: 422 },
				);
			}

			console.error(`Importer error [${response.status}]: ${errorText}`);
			return NextResponse.json(
				{ error: "The import service encountered an error. Please try again." },
				{ status: 502 },
			);
		}

		// Stream the response from the worker to the client
		const stream = new ReadableStream({
			async start(controller) {
				const reader = response.body?.getReader();
				if (!reader) {
					controller.close();
					return;
				}

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						controller.enqueue(value);
					}
				} catch (error) {
					controller.error(error);
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return NextResponse.json(
				{
					error:
						"The import timed out. The file may be too large or the service is busy.",
				},
				{ status: 504 },
			);
		}

		console.error("Importer connection error:", error);
		return NextResponse.json(
			{
				error:
					"Could not connect to the import service. Please check that it is running.",
			},
			{ status: 503 },
		);
	} finally {
		clearTimeout(timeout);
	}
}
