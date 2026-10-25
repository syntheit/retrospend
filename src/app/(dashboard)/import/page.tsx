import { Suspense } from "react";
import { ImportPage } from "~/features/import/import-page";

export default function Page() {
	// ?job= opens that file's review (a link from Recent imports or Needs you).
	return (
		<Suspense>
			<ImportPage />
		</Suspense>
	);
}
