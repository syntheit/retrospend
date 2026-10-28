import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { MoneyPrefsProvider } from "~/components/money/use-money-locale";
import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { AppShell } from "~/components/shell/app-shell";
import { EntrySheetsProvider } from "~/features/entry/provider";
import { LocaleSync } from "~/i18n/locale-sync";
import { getWebSession } from "~/server/better-auth/web-session";
import { db } from "~/server/db";
import { api, HydrateClient } from "~/trpc/server";

export const metadata: Metadata = {
	title: {
		default: "Dashboard",
		template: "%s - Retrospend",
	},
};

export default async function Layout({ children }: { children: ReactNode }) {
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

	return (
		<HydrateClient>
			<LocaleSync
				cookieLocale={currentCookie}
				dbLocale={user?.language ?? "en"}
			/>
			<MoneyPrefsProvider>
				<EntrySheetsProvider>
					<RecurringModalProvider>
						<RevisionHistoryProvider>
							<AppShell>{children}</AppShell>
						</RevisionHistoryProvider>
					</RecurringModalProvider>
				</EntrySheetsProvider>
			</MoneyPrefsProvider>
		</HydrateClient>
	);
}
