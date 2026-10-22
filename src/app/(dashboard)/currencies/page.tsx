import { headers } from "next/headers";
import { Suspense } from "react";
import { CurrenciesPage } from "~/features/currencies/currencies-page";
import { CurrenciesSkeleton } from "~/features/currencies/currencies-states";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyCurrenciesPage from "./legacy-page";

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyCurrenciesPage />;
	const params = await searchParams;
	// ?currency= is how the palette links today; ?cur= the mockup's name.
	const raw = params.currency ?? params.cur;
	const code = typeof raw === "string" ? raw.toUpperCase() : null;
	return (
		<Suspense fallback={<CurrenciesSkeleton />}>
			<CurrenciesPage initial={code} />
		</Suspense>
	);
}
