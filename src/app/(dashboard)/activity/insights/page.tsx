import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AfterHydration } from "~/components/after-hydration";
import { PageFrame } from "~/components/layout/page-frame";
import { InsightsPage } from "~/features/insights/insights-page";
import { InsightsSkeleton } from "~/features/insights/part-states";

export async function generateMetadata() {
	const t = await getTranslations("insights");
	return { title: t("metaTitle") };
}

const fallback = (
	<PageFrame>
		<InsightsSkeleton />
	</PageFrame>
);

/**
 * Renders after hydration: the range and the filters read the URL, and the
 * dates ("This month", "Year to date") are the browser's.
 */
export default function Page() {
	return (
		<Suspense fallback={fallback}>
			<AfterHydration fallback={fallback}>
				<InsightsPage />
			</AfterHydration>
		</Suspense>
	);
}
