import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "~/server/better-auth";
import { LoginForm } from "./_components/login-form";

export default async function LoginPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	// A disabled account's leftover session must not bounce back to the
	// dashboard (which rejects inactive users), or the two would redirect-loop.
	if (session?.user.isActive) {
		redirect("/dashboard");
	}

	return <LoginForm />;
}
