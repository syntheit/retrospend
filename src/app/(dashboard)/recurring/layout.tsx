import type { Metadata } from "next";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
	title: "Recurring",
};

export default async function Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	void api.recurring.list.prefetch();

	return children;
}
