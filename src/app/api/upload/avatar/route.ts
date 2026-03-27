import { type NextRequest, NextResponse } from "next/server";
import { processAvatar } from "~/server/image-processing";
import { deleteFile, getImageUrl, uploadFile } from "~/server/storage";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";

async function getAuthenticatedUserId(
	request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
	// Guests authenticate via x-guest-token + GuestSession, not better-auth sessions.
	// If auth.api.getSession() returns a user, it is always a real (non-guest) account.
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

	if (!file || !(file instanceof File)) {
		return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
		processed = await processAvatar(buffer);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Invalid image format";
		return NextResponse.json({ error: message }, { status: 400 });
	}

	const filePath = `avatars/${userId}-${Date.now()}.webp`;

	try {
		await uploadFile(filePath, processed, "image/webp");
	} catch (err) {
		console.error("Avatar upload failed:", err);
		return NextResponse.json(
			{ error: "Failed to upload image. Please try again." },
			{ status: 500 },
		);
	}

	// Read old avatar path before updating so we can delete it after
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { avatarPath: true },
	});

	// TODO: if DB update fails after upload, the new file becomes orphaned on disk.
	// A periodic cleanup job could remove unreferenced files.
	await db.user.update({
		where: { id: userId },
		data: { avatarPath: filePath },
	});

	if (user?.avatarPath) {
		try {
			await deleteFile(user.avatarPath);
		} catch (err) {
			console.warn("Failed to delete old avatar (may already be gone):", err);
		}
	}

	return NextResponse.json({ avatarUrl: getImageUrl(filePath) });
}

export async function DELETE(request: NextRequest) {
	const auth_result = await getAuthenticatedUserId(request);
	if (auth_result instanceof NextResponse) return auth_result;
	const { userId } = auth_result;

	const user = await db.user.findUnique({
		where: { id: userId },
		select: { avatarPath: true },
	});

	if (!user?.avatarPath) {
		return NextResponse.json({ success: true });
	}

	try {
		await deleteFile(user.avatarPath);
	} catch (err) {
		console.warn("Failed to delete avatar from storage:", err);
	}

	await db.user.update({
		where: { id: userId },
		data: { avatarPath: null },
	});

	return NextResponse.json({ success: true });
}
