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
 * or denies it. The proxy sends signed-out visitors to /login first.
 */
export default async function DevicePage({
	searchParams,
}: {
	searchParams: Promise<{ user_code?: string | string[] }>;
}) {
	const session = await getSession();
	if (!session?.user.isActive) redirect("/login?callbackUrl=/device");

	const { user_code } = await searchParams;
	const code = Array.isArray(user_code) ? user_code[0] : user_code;
	return <DeviceApproval initialCode={code ?? ""} />;
}
