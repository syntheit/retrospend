"use client";

import { useTranslations } from "next-intl";

import { ActivityFeed } from "~/components/project/activity-feed-panel";
import { Card, CardContent } from "~/components/ui/card";

// Renders the shared ActivityFeed body (filters + list + infinite scroll) in a
// plain card — no Sheet chrome. Used by the project's Activity tab.
export function ActivityTab({ projectId }: { projectId: string }) {
	const t = useTranslations("projects");

	return (
		<Card>
			<CardContent className="p-4 sm:p-6">
				<ActivityFeed
					header={
						<h3 className="font-semibold text-base tracking-tight">
							{t("activity")}
						</h3>
					}
					layout="panel"
					projectId={projectId}
				/>
			</CardContent>
		</Card>
	);
}
