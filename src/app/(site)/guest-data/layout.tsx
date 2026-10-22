import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

export async function generateMetadata() {
	const t = await getTranslations("guestData");
	return { title: t("metaTitle") };
}

export default function Layout({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
