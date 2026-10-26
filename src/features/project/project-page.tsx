"use client";

import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { AppShell } from "~/components/shell/app-shell";
import { EntrySheetsProvider } from "~/features/entry/provider";
import { ProjectScreen } from "./project-screen";

/**
 * The project page for a signed-in member. The route sits outside the
 * dashboard layout (it also serves guests and public links), so it brings
 * its own shell and the expense, recurring and history providers.
 */
export function ProjectPage({ id }: { id: string }) {
	return (
		<EntrySheetsProvider>
			<RecurringModalProvider>
				<RevisionHistoryProvider>
					<AppShell>
						<ProjectScreen id={id} />
					</AppShell>
				</RevisionHistoryProvider>
			</RecurringModalProvider>
		</EntrySheetsProvider>
	);
}
