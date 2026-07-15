import { getTranslations } from "next-intl/server";
import { api } from "~/trpc/server";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("recurring") };
}

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	void api.recurring.list.prefetch();

	return children;
}
