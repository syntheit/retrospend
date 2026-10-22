import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { requestTimeZone } from "~/server/time-zone";
import { AfterHydration } from "~/components/after-hydration";
import { HydrateClient, api } from "~/trpc/server";
import Loading from "./loading";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("dashboard") };
}

/**
 * Sends the page's data with the HTML (only settled queries are sent, see
 * shouldDehydrateQuery in ~/trpc/query-client). The page itself renders after
 * hydration because its dates depend on the browser's zone and clock.
 */
async function Prefetched({ children }: { children: React.ReactNode }) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	// Same month label the browser computes, so the prefetch is reused
	const timeZone = requestTimeZone(await headers());
	const month = getCurrentFiscalMonth(new Date(), fiscalStartDay, timeZone);

	await Promise.all([
		api.dashboard.getOverviewData.prefetch({ month, homeCurrency }),
		api.dashboard.getRecentActivity.prefetch({ homeCurrency }),
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
