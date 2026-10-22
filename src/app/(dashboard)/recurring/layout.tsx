import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AfterHydration } from "~/components/after-hydration";
import { HydrateClient, api } from "~/trpc/server";
import Loading from "./loading";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("recurring") };
}

/**
 * Sends the page's data with the HTML (only settled queries are sent, see
 * shouldDehydrateQuery in ~/trpc/query-client). The page itself renders after
 * hydration because its dates depend on the browser's zone and clock.
 */
async function Prefetched({ children }: { children: React.ReactNode }) {
	await Promise.all([
		api.recurring.list.prefetch(),
		api.system.getServerTime.prefetch(),
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
