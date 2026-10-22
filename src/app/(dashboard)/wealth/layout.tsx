import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AfterHydration } from "~/components/after-hydration";
import { HydrateClient, api } from "~/trpc/server";
import Loading from "./loading";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("wealth") };
}

/**
 * Sends the page's data with the HTML (only settled queries are sent, see
 * shouldDehydrateQuery in ~/trpc/query-client). The page itself renders after
 * hydration because its dates depend on the browser's zone and clock.
 */
async function Prefetched({ children }: { children: React.ReactNode }) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";

	await Promise.all([
		api.wealth.getDashboard.prefetch({ currency: homeCurrency }),
		api.wealth.getRunwayStats.prefetch({ currency: homeCurrency }),
	]);
	return (
		<HydrateClient>
			<AfterHydration fallback={<Loading />}>{children}</AfterHydration>
		</HydrateClient>
	);
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<Suspense fallback={<Loading />}>
			<Prefetched>{children}</Prefetched>
		</Suspense>
	);
}
