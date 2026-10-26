import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPanel } from "~/components/admin/admin-panel";
import { getWebSession } from "~/server/better-auth/web-session";

export default async function AdminPage() {
	const session = await getWebSession(await headers());

	if (!session) {
		redirect("/login");
	}

	if ((session.user as { role?: string }).role !== "ADMIN") {
		redirect("/home");
	}

	return <AdminPanel />;
}
