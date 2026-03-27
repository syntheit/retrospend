import { TRPCError } from "@trpc/server";
import { type NextRequest, NextResponse } from "next/server";
import { processProjectImage } from "~/server/image-processing";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";

async function getAuthenticatedUserId(
	request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const activeUser = await db.user.findUnique({
		where: { id: session.user.id },
		select: { isActive: true },
	});

	if (!activeUser?.isActive) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	return { userId: session.user.id };
}

export async function POST(request: NextRequest) {
	const auth_result = await getAuthenticatedUserId(request);
	if (auth_result instanceof NextResponse) return auth_result;
	const { userId } = auth_result;

	const formData = await request.formData();
	const file = formData.get("file");
	const projectId = formData.get("projectId");

	if (!projectId || typeof projectId !== "string") {
		return NextResponse.json(
			{ error: "projectId is required" },
			{ status: 400 },
		);
	}

	if (!file || !(file instanceof File)) {
		return NextResponse.json({ error: "No file provided" }, { status: 400 });
	}

	try {
		await requireProjectRole(db, projectId, "user", userId, "EDITOR");
	} catch (err) {
		if (err instanceof TRPCError) {
			const status = err.code === "NOT_FOUND" ? 404 : 403;
			return NextResponse.json({ error: err.message }, { status });
		}
		throw err;
	}

	if (file.size > 5 * 1024 * 1024) {
		return NextResponse.json(
			{ error: "File too large. Maximum 5MB." },
			{ status: 400 },
		);
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	let processed: Buffer;
	try {
		processed = await processProjectImage(buffer);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Invalid image format";
		return NextResponse.json({ error: message }, { status: 400 });
	}

	const filePath = `projects/${projectId}-${Date.now()}.webp`;

	try {
		await uploadFile(filePath, processed, "image/webp");
	} catch (err) {
		console.error("Project image upload failed:", err);
		return NextResponse.json(
			{ error: "Failed to upload image. Please try again." },
			{ status: 500 },
		);
	}

	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { imagePath: true },
	});
	const oldPath = project?.imagePath ?? null;

	// TODO: if DB update fails after upload, the new file becomes orphaned on disk.
	// A periodic cleanup job could remove unreferenced files.
	await db.project.update({
		where: { id: projectId },
		data: { imagePath: filePath },
	});

	if (oldPath) {
		try {
			await deleteFile(oldPath);
		} catch (err) {
			console.warn(
				"Failed to delete old project image (may already be gone):",
				err,
			);
		}
	}

	await logAudit(db, {
		actor: { participantType: "user", participantId: userId },
		action: "EDITED",
		targetType: "PROJECT",
		targetId: projectId,
		changes: { imagePath: { old: oldPath, new: filePath } },
		projectId,
	});

	return NextResponse.json({ imageUrl: getImageUrl(filePath) });
}

export async function DELETE(request: NextRequest) {
	const auth_result = await getAuthenticatedUserId(request);
	if (auth_result instanceof NextResponse) return auth_result;
	const { userId } = auth_result;

	const { searchParams } = new URL(request.url);
	const projectId = searchParams.get("projectId");

	if (!projectId) {
		return NextResponse.json(
			{ error: "projectId is required" },
			{ status: 400 },
		);
	}

	try {
		await requireProjectRole(db, projectId, "user", userId, "EDITOR");
	} catch (err) {
		if (err instanceof TRPCError) {
			const status = err.code === "NOT_FOUND" ? 404 : 403;
			return NextResponse.json({ error: err.message }, { status });
		}
		throw err;
	}

	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { imagePath: true },
	});

	if (!project?.imagePath) {
		return NextResponse.json({ success: true });
	}

	const oldPath = project.imagePath;

	try {
		await deleteFile(oldPath);
	} catch (err) {
		console.warn("Failed to delete project image from storage:", err);
	}

	await db.project.update({
		where: { id: projectId },
		data: { imagePath: null },
	});

	await logAudit(db, {
		actor: { participantType: "user", participantId: userId },
		action: "EDITED",
		targetType: "PROJECT",
		targetId: projectId,
		changes: { imagePath: { old: oldPath, new: null } },
		projectId,
	});

	return NextResponse.json({ success: true });
}
