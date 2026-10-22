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
import { AppShell } from "~/components/shell/app-shell";
import { db } from "~/server/db";
import { isFlagEnabled } from "~/server/flags";
import { HydrateClient, api } from "~/trpc/server";
import { getWebSession } from "~/server/better-auth/web-session";

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
	const session = await getWebSession(await headers());

	// Disabled accounts are treated as signed out (the login page does the same,
	// so this cannot loop).
	if (!session || !session.user.isActive) {
		redirect("/login");
	}

	// Sync DB language preference -> locale cookie
	const cookieStore = await cookies();
	const currentCookie = cookieStore.get("locale")?.value;
	const user = await db.user.findUnique({
		where: { id: session.user.id },
		select: { language: true },
	});

	// Settings used by every dashboard page. Awaited so the browser hydrates
	// with the same settings the server rendered with.
	await api.settings.getGeneral.prefetch();

	// uiV2Mode picks the shell per viewer; off renders today's shell as it was.
	const uiV2 = await isFlagEnabled("uiV2", session.user);

	return (
		<HydrateClient>
			<LocaleSync
				cookieLocale={currentCookie}
				dbLocale={user?.language ?? "en"}
			/>
			<ExpenseModalProvider>
				<RecurringModalProvider>
					<RevisionHistoryProvider>
						{uiV2 ? (
							<AppShell>{children}</AppShell>
						) : (
							<>
								<DashboardLayout>{children}</DashboardLayout>
								<CommandPalette />
							</>
						)}
					</RevisionHistoryProvider>
				</RecurringModalProvider>
			</ExpenseModalProvider>
		</HydrateClient>
	);
}
