import { Suspense } from "react";
import { CurrenciesPage } from "~/features/currencies/currencies-page";
import { CurrenciesSkeleton } from "~/features/currencies/currencies-states";

export default async function Page({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
