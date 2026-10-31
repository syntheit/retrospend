import { TRPCError } from "@trpc/server";
import { type NextRequest, NextResponse } from "next/server";
import { getWebSession } from "~/server/better-auth/web-session";
import { uploadAccountIcon } from "~/server/services/accounts/icon";

const STATUS = {
	NOT_FOUND: 404,
	BAD_REQUEST: 400,
	FORBIDDEN: 403,
} as const;

/**
 * Upload the person's own picture as an account's icon (form fields `file`
 * and `accountId`). The same session, size and type checks as the profile
 * picture; removing the icon is wealth.setAssetIcon with null.
 */
export async function POST(request: NextRequest) {
	const session = await getWebSession(request.headers);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const formData = await request.formData();
	const file = formData.get("file");
	const accountId = formData.get("accountId");
	if (!accountId || typeof accountId !== "string") {
		return NextResponse.json(
			{ error: "accountId is required" },
			{ status: 400 },
		);
	}
	if (!file || !(file instanceof File)) {
		return NextResponse.json({ error: "No file provided" }, { status: 400 });
	}

	try {
		const icon = await uploadAccountIcon(
			session.user.id,
			accountId,
			Buffer.from(await file.arrayBuffer()),
		);
		return NextResponse.json({ imageUrl: icon.value });
	} catch (err) {
		if (err instanceof TRPCError) {
			const status = STATUS[err.code as keyof typeof STATUS] ?? 500;
			return NextResponse.json({ error: err.message }, { status });
		}
		console.error("Account icon upload failed:", err);
		return NextResponse.json(
			{ error: "Failed to upload image. Please try again." },
			{ status: 500 },
		);
	}
}
