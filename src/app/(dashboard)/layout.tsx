import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CommandPalette } from "~/components/command-palette";
import { DashboardLayout } from "~/components/dashboard-layout";
import { ExpenseModalProvider } from "~/components/expense-modal-provider";
import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { auth } from "~/server/better-auth";
import { HydrateClient, api } from "~/trpc/server";

export const metadata: Metadata = {
	title: {
		default: "Dashboard",
		template: "%s - Retrospend",
	},
};

export default async function Layout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session) {
		redirect("/login");
	}

	// Prefetch settings used by every dashboard page
	void api.settings.getGeneral.prefetch();

	return (
		<HydrateClient>
			<ExpenseModalProvider>
				<RecurringModalProvider>
					<RevisionHistoryProvider>
						<DashboardLayout>{children}</DashboardLayout>
						<CommandPalette />
					</RevisionHistoryProvider>
				</RecurringModalProvider>
			</ExpenseModalProvider>
		</HydrateClient>
	);
}
