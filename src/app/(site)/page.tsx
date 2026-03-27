import { redirect } from "next/navigation";
import { env } from "~/env";
import { LandingPage } from "./_components/landing/landing-page";

export const dynamic = "force-dynamic";

export default async function RootPage() {
	const showLandingPage = env.NEXT_PUBLIC_SHOW_LANDING_PAGE === "true";

	if (!showLandingPage) {
		redirect("/dashboard");
	}

	return (
		<LandingPage
			showLegalLinks={env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES === "true"}
		/>
	);
}
