import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

export async function generateMetadata() {
	const t = await getTranslations("activity.header");
	return { title: t("title") };
}

export default function Layout({ children }: { children: ReactNode }) {
	return children;
}
