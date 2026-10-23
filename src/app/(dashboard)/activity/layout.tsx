import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

export async function generateMetadata() {
	const t = await getTranslations("activity.header");
	return { title: t("title") };
}

/**
 * Activity and its tabs exist only behind uiV2 (IMPLEMENTATION §6.4). With
 * the flag off these routes are not there, and today's /transactions and
 * /recurring stay as they are.
 */
export default async function Layout({ children }: { children: ReactNode }) {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user))) notFound();
	return children;
}
