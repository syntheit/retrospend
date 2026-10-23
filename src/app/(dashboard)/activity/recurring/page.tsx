import { getTranslations } from "next-intl/server";
import { AfterHydration } from "~/components/after-hydration";
import { PageFrame } from "~/features/activity/page-frame";
import {
	RecurringPage,
	RecurringSkeleton,
} from "~/features/recurring/recurring-page";

export async function generateMetadata() {
	const t = await getTranslations("activityRecurring");
	return { title: t("metaTitle") };
}

/** Renders after hydration: due states and "in N days" are the browser's. */
export default function Page() {
	return (
		<AfterHydration
			fallback={
				<PageFrame>
					<RecurringSkeleton />
				</PageFrame>
			}
		>
			<RecurringPage />
		</AfterHydration>
	);
}
