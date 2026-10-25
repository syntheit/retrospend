import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { HomePage } from "~/features/home/home-page";
import { HomeSkeleton } from "~/features/home/home-states";

export async function generateMetadata() {
	const t = await getTranslations("homePage");
	return { title: t("title") };
}

export default function Page() {
	return (
		<Suspense fallback={<HomeSkeleton />}>
			<HomePage />
		</Suspense>
	);
}
