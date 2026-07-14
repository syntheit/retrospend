import { getTranslations } from "next-intl/server";
import { api } from "~/trpc/server";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("wealth") };
}

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	const settings = await api.settings.getGeneral();
	const homeCurrency = settings?.homeCurrency ?? "USD";

	void api.wealth.getDashboard.prefetch({ currency: homeCurrency });
	void api.wealth.getRunwayStats.prefetch({ currency: homeCurrency });

	return children;
}
