import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { db } from "~/server/db";
import { getWebSession } from "~/server/better-auth/web-session";
import {
	AI_IMPORT_OFF_MESSAGE,
	isAiImportEnabled,
	resolveAiAccess,
} from "~/server/services/ai-access.service";

export async function POST(request: NextRequest) {
	// Validate session
	const session = await getWebSession(request.headers);

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Check if user is still active (mirrors protectedProcedure isActive check)
	const activeUser = await db.user.findUnique({
		where: { id: session.user.id },
		select: { isActive: true },
	});

	if (!activeUser?.isActive) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// The same gate and quota as the import queue: no file reaches a provider
	// unless the person turned AI import on.
	if (!(await isAiImportEnabled(db, session.user.id))) {
		return NextResponse.json({ error: AI_IMPORT_OFF_MESSAGE }, { status: 403 });
	}
	const mode = await db.user.findUnique({
		where: { id: session.user.id },
		select: { aiMode: true },
	});
	const aiAccess = await resolveAiAccess(
		db,
		session.user.id,
		mode?.aiMode ?? "LOCAL",
	);
	if (!aiAccess.allowed) {
		return NextResponse.json(
			{ error: aiAccess.reason ?? "AI token quota exceeded" },
			{ status: 429 },
		);
	}

	const importerUrl = env.SIDECAR_URL;
	if (!importerUrl) {
		return NextResponse.json(
			{ error: "Import service is not configured" },
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

	// Validate file size (10MB limit)
	const MAX_FILE_SIZE = 10 * 1024 * 1024;
	if (file.size > MAX_FILE_SIZE) {
		return NextResponse.json(
			{ error: "File too large. Maximum size is 10MB." },
			{ status: 413 },
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
	importerFormData.append(
		"provider",
		aiAccess.effectiveMode === "EXTERNAL" ? "openrouter" : "local",
	);

	const currency = formData.get("currency");
	if (currency && typeof currency === "string") {
		if (!/^[A-Za-z]{3}$/.test(currency)) {
			return NextResponse.json(
				{ error: "Invalid currency code. Must be a 3-letter code." },
				{ status: 400 },
			);
		}
		importerFormData.append("currency", currency);
	}

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

		const startLogging = async (status: string, reason?: string) => {
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
							fileType: file.type || ext.slice(1),
							fileSize: file.size,
							duration_ms: duration,
							status,
							reason,
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
				await startLogging("conflict", "file_already_imported");
				return NextResponse.json(
					{ error: "This file has already been imported." },
					{ status: 409 },
				);
			}

			if (response.status === 422) {
				await startLogging("unprocessable", "importer_rejected_file");
				return NextResponse.json(
					{
						error: `Could not parse the file: ${errorText}`,
					},
					{ status: 422 },
				);
			}

			console.error(`Importer error [${response.status}]`);
			await startLogging("error", `importer_http_${response.status}`);
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
					await startLogging("error", "no_response_body");
					controller.close();
					return;
				}

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							await startLogging("success");
							break;
						}
						controller.enqueue(value);
					}
				} catch (error) {
					await startLogging("error", "stream_failed");
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
							fileType: file.type || ext.slice(1),
							fileSize: file.size,
							duration_ms: duration,
							status: "timeout",
							reason: "import_timed_out",
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
						fileType: file.type || ext.slice(1),
						fileSize: file.size,
						duration_ms: duration,
						status: "connection_error",
						reason: "importer_unreachable",
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
