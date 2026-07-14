import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

export async function generateMetadata() {
	const t = await getTranslations("sidebar");
	return { title: t("import") };
}

export default function Layout({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
