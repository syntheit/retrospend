import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";

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
	const ext = name.slice(name.lastIndexOf("."));
	if (!ext.endsWith(".csv") && !ext.endsWith(".pdf")) {
		return NextResponse.json(
			{ error: "Unsupported file type. Please upload a CSV or PDF file." },
			{ status: 422 },
		);
	}

	// Record start time
	const startTime = Date.now();

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

		const startLogging = async (
			status: string,
			metadata: Record<string, unknown> = {},
		) => {
			const duration = Date.now() - startTime;
			try {
				await db.eventLog.create({
					data: {
						eventType: "EXPENSE_IMPORT",
						userId: session.user.id,
						ipAddress:
							request.headers.get("x-forwarded-for") ??
							request.headers.get("x-real-ip") ??
							null,
						userAgent: request.headers.get("user-agent"),
						metadata: {
							fileName: file.name,
							fileType: file.type || ext.slice(1),
							fileSize: file.size,
							duration_ms: duration,
							status,
							...metadata,
						},
					},
				});
			} catch (err) {
				console.error("Failed to log import event:", err);
			}
		};

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");

			if (response.status === 409) {
				await startLogging("conflict", { error: "File already imported" });
				return NextResponse.json(
					{ error: "This file has already been imported." },
					{ status: 409 },
				);
			}

			if (response.status === 422) {
				await startLogging("unprocessable", { error: errorText });
				return NextResponse.json(
					{
						error: `Could not parse the file: ${errorText}`,
					},
					{ status: 422 },
				);
			}

			console.error(`Importer error [${response.status}]: ${errorText}`);
			await startLogging("error", {
				status: response.status,
				error: errorText,
			});
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
					await startLogging("error", {
						error: "No response body from importer",
					});
					controller.close();
					return;
				}

				try {
					let totalBytes = 0;
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							await startLogging("success", {
								total_bytes_streamed: totalBytes,
							});
							break;
						}
						totalBytes += value.length;
						controller.enqueue(value);
					}
				} catch (error) {
					await startLogging("error", {
						error: error instanceof Error ? error.message : String(error),
					});
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
			// Note: startLogging might not work here as we don't have all constants in scope or they might fail.
			// But since we want to record duration, let's try a simple log.
			try {
				const duration = Date.now() - startTime;
				await db.eventLog.create({
					data: {
						eventType: "EXPENSE_IMPORT",
						userId: session.user.id,
						ipAddress:
							request.headers.get("x-forwarded-for") ??
							request.headers.get("x-real-ip") ??
							null,
						userAgent: request.headers.get("user-agent"),
						metadata: {
							fileName: file.name,
							fileType: file.type || ext.slice(1),
							fileSize: file.size,
							duration_ms: duration,
							status: "timeout",
							error: "The import timed out",
						},
					},
				});
			} catch (e) {
				console.error("Failed to log timeout:", e);
			}

			return NextResponse.json(
				{
					error:
						"The import timed out. The file may be too large or the service is busy.",
				},
				{ status: 504 },
			);
		}

		console.error("Importer connection error:", error);

		try {
			const duration = Date.now() - startTime;
			await db.eventLog.create({
				data: {
					eventType: "EXPENSE_IMPORT",
					userId: session.user.id,
					ipAddress:
						request.headers.get("x-forwarded-for") ??
						request.headers.get("x-real-ip") ??
						null,
					userAgent: request.headers.get("user-agent"),
					metadata: {
						fileName: file.name,
						fileType: file.type || ext.slice(1),
						fileSize: file.size,
						duration_ms: duration,
						status: "connection_error",
						error: error instanceof Error ? error.message : String(error),
					},
				},
			});
		} catch (e) {
			console.error("Failed to log connection error:", e);
		}

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
