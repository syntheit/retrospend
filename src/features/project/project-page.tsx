"use client";

import { ExpenseModalProvider } from "~/components/expense-modal-provider";
import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { ShellSwitch } from "~/components/shell/shell-switch";
import { ProjectScreen } from "./project-screen";

/**
 * The redesigned project page (uiV2) for a signed-in member. The route sits
 * outside the dashboard layout, so like today's page it brings its own
 * shell and the expense, recurring and history providers.
 */
export function ProjectPage({ id }: { id: string }) {
	return (
		<ExpenseModalProvider>
			<RecurringModalProvider>
				<RevisionHistoryProvider>
					<ShellSwitch>
						<ProjectScreen id={id} />
					</ShellSwitch>
				</RevisionHistoryProvider>
			</RecurringModalProvider>
		</ExpenseModalProvider>
	);
}
