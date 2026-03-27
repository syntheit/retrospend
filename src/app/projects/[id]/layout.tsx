import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Project",
	description: "View a shared expense project",
};

export default function Layout({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
