import { Suspense } from "react";
import { PeopleSkeleton } from "~/features/people/people-states";
import { PersonPage } from "~/features/person/person-page";

type Params = Promise<{ type: string; id: string }>;

export default async function Page({ params }: { params: Params }) {
	const { type, id } = await params;
	return (
		<Suspense fallback={<PeopleSkeleton />}>
			<PersonPage id={decodeURIComponent(id)} type={type} />
		</Suspense>
	);
}
