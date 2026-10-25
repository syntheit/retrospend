import { Suspense } from "react";
import { WealthPage } from "~/features/wealth/wealth-page";
import { WealthSkeleton } from "~/features/wealth/wealth-states";

export default function Page() {
	return (
		<Suspense fallback={<WealthSkeleton />}>
			<WealthPage />
		</Suspense>
	);
}
