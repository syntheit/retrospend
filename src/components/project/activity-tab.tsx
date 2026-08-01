"use client";

import { ActivityFeed } from "~/components/project/activity-feed-panel";

// Renders the shared ActivityFeed body (filters + list + infinite scroll) with no
// card chrome or header — it floats on the project background like the Expenses tab.
export function ActivityTab({ projectId }: { projectId: string }) {
	return <ActivityFeed layout="panel" projectId={projectId} />;
}
