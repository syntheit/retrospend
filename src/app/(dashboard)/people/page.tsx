import { Suspense } from "react";
import { PeoplePage } from "~/features/people/people-page";
import { PeopleSkeleton } from "~/features/people/people-states";

export default function Page() {
	return (
		<Suspense fallback={<PeopleSkeleton />}>
			<PeoplePage />
		</Suspense>
	);
}
