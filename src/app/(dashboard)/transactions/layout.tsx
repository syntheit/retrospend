import type { Metadata } from "next";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
	title: "Transactions",
};

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	void api.expense.listFinalized.prefetch();
	void api.expense.listSharedParticipations.prefetch();
	void api.expense.getFilterOptions.prefetch();
	void api.categories.getAll.prefetch();

	return children;
}
