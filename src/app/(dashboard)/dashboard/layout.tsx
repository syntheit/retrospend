import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { requestTimeZone } from "~/server/time-zone";
import { api } from "~/trpc/server";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("dashboard") };
}

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	// Same month label the browser computes, so the prefetch is reused
	const timeZone = requestTimeZone(await headers());
	const month = getCurrentFiscalMonth(new Date(), fiscalStartDay, timeZone);

	void api.dashboard.getOverviewData.prefetch({ month, homeCurrency });
	void api.dashboard.getRecentActivity.prefetch({ homeCurrency });

	return children;
}
