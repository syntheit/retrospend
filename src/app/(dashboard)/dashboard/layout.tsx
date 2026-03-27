import type { Metadata } from "next";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
	title: "Dashboard",
};

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	const month = getCurrentFiscalMonth(new Date(), fiscalStartDay);

	void api.dashboard.getOverviewData.prefetch({ month, homeCurrency });
	void api.dashboard.getRecentActivity.prefetch({ homeCurrency });
	void api.dashboard.getDailySpending.prefetch({ homeCurrency, days: 90 });

	return children;
}
