import { TRPCError } from "@trpc/server";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { removeAvatar, replaceAvatar } from "~/server/services/avatar.service";
import { getWebSession } from "~/server/better-auth/web-session";

async function getAuthenticatedUserId(
	request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
	// Guests authenticate via x-guest-token + GuestSession, not better-auth sessions.
	// If getWebSession() returns a user, it is always a real (non-guest) account.
	const session = await getWebSession(request.headers);

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

	try {
		const result = await replaceAvatar(
			db,
			userId,
			Buffer.from(await file.arrayBuffer()),
		);
		return NextResponse.json(result);
	} catch (err) {
		if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
			return NextResponse.json({ error: err.message }, { status: 400 });
		}
		console.error("Avatar upload failed:", err);
		return NextResponse.json(
			{ error: "Failed to upload image. Please try again." },
			{ status: 500 },
		);
	}
}

export async function DELETE(request: NextRequest) {
	const auth_result = await getAuthenticatedUserId(request);
	if (auth_result instanceof NextResponse) return auth_result;
	await removeAvatar(db, auth_result.userId);
	return NextResponse.json({ success: true });
}
