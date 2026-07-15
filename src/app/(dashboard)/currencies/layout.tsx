import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("currencies") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
