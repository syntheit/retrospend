import { getTranslations } from "next-intl/server";
import { api } from "~/trpc/server";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("transactions") };
}

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	void api.expense.listFinalized.prefetch();
	void api.expense.listSharedParticipations.prefetch();
	void api.expense.getFilterOptions.prefetch();
	void api.categories.getAll.prefetch();

	return children;
}
