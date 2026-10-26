import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "./_components/login-form";
import { getWebSession } from "~/server/better-auth/web-session";

export default async function LoginPage() {
	const session = await getWebSession(await headers());

	// A disabled account's leftover session must not bounce back to the
	// dashboard (which rejects inactive users), or the two would redirect-loop.
	if (session?.user.isActive) {
		redirect("/home");
	}

	return <LoginForm />;
}
