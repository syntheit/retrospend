import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CommandPalette } from "~/components/command-palette";
import { DashboardLayout } from "~/components/dashboard-layout";
import { ExpenseModalProvider } from "~/components/expense-modal-provider";
import { LocaleSync } from "~/i18n/locale-sync";
import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
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

	// Sync DB language preference -> locale cookie
	const cookieStore = await cookies();
	const currentCookie = cookieStore.get("locale")?.value;
	const user = await db.user.findUnique({
		where: { id: session.user.id },
		select: { language: true },
	});

	// Prefetch settings used by every dashboard page
	void api.settings.getGeneral.prefetch();

	return (
		<HydrateClient>
			<LocaleSync
				cookieLocale={currentCookie}
				dbLocale={user?.language ?? "en"}
			/>
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
