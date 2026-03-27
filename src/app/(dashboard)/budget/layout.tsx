import type { Metadata } from "next";
import { getCurrentFiscalMonth } from "~/lib/fiscal-month";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
	title: "Budget",
};

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	const settings = await api.settings.getGeneral();
	const fiscalStartDay = settings?.fiscalMonthStartDay ?? 1;
	const month = getCurrentFiscalMonth(new Date(), fiscalStartDay);

	void api.system.getServerTime.prefetch();
	void api.budget.getBudgets.prefetch({ month });
	void api.categories.getAll.prefetch();
	void api.budget.hasBudgetsBeforeMonth.prefetch({ month });

	return children;
}
