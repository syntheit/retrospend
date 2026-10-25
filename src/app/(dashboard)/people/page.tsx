import { Suspense } from "react";
import { PeoplePage } from "~/features/people/people-page";
import { PeopleSkeleton } from "~/features/people/people-states";

// The page reads the signed-in person on the server; never prerender it.
export const dynamic = "force-dynamic";

export default function Page() {
	return (
		<Suspense fallback={<PeopleSkeleton />}>
			<PeoplePage />
		</Suspense>
	);
}
