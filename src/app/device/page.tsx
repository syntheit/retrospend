import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "~/server/better-auth/server";
import { DeviceApproval } from "./device-approval";

export const metadata: Metadata = {
	title: "Connect a device",
	description: "Approve a device that asks to use your Retrospend account.",
};

/**
 * RFC 8628 verification page. A CLI or desktop client shows a code and this
 * URL; the signed-in person reviews what the device asks for and approves
 * or denies it. Signed-out visitors go to /login and come back with the
 * code.
 */
export default async function DevicePage({
	searchParams,
}: {
	searchParams: Promise<{ user_code?: string | string[] }>;
}) {
	const { user_code } = await searchParams;
	const code = (Array.isArray(user_code) ? user_code[0] : user_code) ?? "";

	// Only the web app's own session may approve a device (getWebSession);
	// send anyone else to sign in and back here with the code.
	const session = await getSession();
	if (!session?.user.isActive) {
		const back = code
			? `/device?user_code=${encodeURIComponent(code)}`
			: "/device";
		redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
	}

	return <DeviceApproval initialCode={code} />;
}
