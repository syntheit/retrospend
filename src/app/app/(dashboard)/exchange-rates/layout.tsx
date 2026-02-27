import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Exchange Rates",
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
