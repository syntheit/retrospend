import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "~/env";
import { SignupForm } from "./_components/signup-form";
import { getWebSession } from "~/server/better-auth/web-session";

export default async function SignupPage() {
	const session = await getWebSession(await headers());

	if (session) {
		redirect("/dashboard");
	}

	return (
		<SignupForm
			enableLegalPages={env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES === "true"}
		/>
	);
}
