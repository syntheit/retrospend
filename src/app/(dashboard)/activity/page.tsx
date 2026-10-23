import { Suspense } from "react";
import { AfterHydration } from "~/components/after-hydration";
import { PageFrame } from "~/components/layout/page-frame";
import { ActivitySkeleton } from "~/features/activity/activity-list";
import { ActivityPage } from "~/features/activity/activity-page";

/**
 * Renders after hydration: the filter reads the URL and the dates ("Today",
 * this month) are the browser's.
 */
export default function Page() {
	return (
		<Suspense
			fallback={
				<PageFrame>
					<ActivitySkeleton />
				</PageFrame>
			}
		>
			<AfterHydration
				fallback={
					<PageFrame>
						<ActivitySkeleton />
					</PageFrame>
				}
			>
				<ActivityPage />
			</AfterHydration>
		</Suspense>
	);
}
