import { Suspense } from "react";
import { WealthPage } from "~/features/wealth/wealth-page";
import { WealthSkeleton } from "~/features/wealth/wealth-states";

// The page reads the signed-in person on the server; never prerender it.
export const dynamic = "force-dynamic";

export default function Page() {
	return (
		<Suspense fallback={<WealthSkeleton />}>
			<WealthPage />
		</Suspense>
	);
}
