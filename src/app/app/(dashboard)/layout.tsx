import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardLayout } from "~/components/dashboard-layout";
import { ExpenseModalProvider } from "~/components/expense-modal-provider";
import { auth } from "~/server/better-auth";

export default async function Layout({
	children,
	modal,
}: {
	children: ReactNode;
	modal: ReactNode;
}) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session) {
		redirect("/login");
	}

	return (
		<ExpenseModalProvider>
			<DashboardLayout>
				{
					<>
						{children}
						{modal}
					</>
				}
			</DashboardLayout>
		</ExpenseModalProvider>
	);
}
