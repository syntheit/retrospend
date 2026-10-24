import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BudgetSheetsHarness } from "~/features/budget/sheets/harness";
import { getWebSession } from "~/server/better-auth/web-session";
import { canSeeGallery } from "../components/access";

export const metadata: Metadata = {
	title: "Budget sheets",
	robots: { index: false, follow: false },
};

/** Opens every Budget sheet on the signed-in user's own book (development and admins only). */
export default async function BudgetSheetsPage() {
	const prod = process.env.NODE_ENV === "production";
	const session = prod ? await getWebSession(await headers()) : null;
	const role = (session?.user as { role?: string } | undefined)?.role;
	if (!canSeeGallery(process.env.NODE_ENV, role)) notFound();
	return <BudgetSheetsHarness />;
}
