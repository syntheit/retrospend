import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getWebSession } from "~/server/better-auth/web-session";
import { canSeeGallery } from "../components/access";
import { CryptoBench } from "./bench";

export const metadata: Metadata = {
	title: "Crypto benchmark",
	robots: { index: false, follow: false },
};

// Same gate as the component gallery: everyone signed in during development,
// admins only in production, a 404 for everyone else.
export default async function CryptoBenchPage() {
	const prod = process.env.NODE_ENV === "production";
	const session = prod ? await getWebSession(await headers()) : null;
	const role = (session?.user as { role?: string } | undefined)?.role;
	if (!canSeeGallery(process.env.NODE_ENV, role)) notFound();
	return <CryptoBench />;
}
