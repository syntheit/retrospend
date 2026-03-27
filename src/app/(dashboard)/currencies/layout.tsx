import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Currencies",
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
