import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPanel } from "~/components/admin/admin-panel";
import { auth } from "~/server/better-auth";

export default async function AdminPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session) {
		redirect("/login");
	}

	if (session.user.role !== "ADMIN") {
		redirect("/app");
	}

	return <AdminPanel />;
}
