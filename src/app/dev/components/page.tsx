import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getWebSession } from "~/server/better-auth/web-session";
import { canSeeGallery } from "./access";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
	title: "Component gallery",
	robots: { index: false, follow: false },
};

export default async function ComponentGalleryPage() {
	const prod = process.env.NODE_ENV === "production";
	const session = prod ? await getWebSession(await headers()) : null;
	const role = (session?.user as { role?: string } | undefined)?.role;
	if (!canSeeGallery(process.env.NODE_ENV, role)) notFound();
	return <Gallery />;
}
