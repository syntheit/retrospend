import type { Metadata } from "next";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
	title: "Wealth",
};

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";

	void api.wealth.getDashboard.prefetch({ currency: homeCurrency });
	void api.wealth.getRunwayStats.prefetch({ currency: homeCurrency });
	void api.wealth.getSharedBalances.prefetch({ currency: homeCurrency });

	return children;
}
