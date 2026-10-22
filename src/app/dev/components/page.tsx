import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "~/server/better-auth";
import { canSeeGallery } from "./access";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
	title: "Component gallery",
	robots: { index: false, follow: false },
};

export default async function ComponentGalleryPage() {
	const prod = process.env.NODE_ENV === "production";
	const session = prod
		? await auth.api.getSession({ headers: await headers() })
		: null;
	const role = (session?.user as { role?: string } | undefined)?.role;
	if (!canSeeGallery(process.env.NODE_ENV, role)) notFound();
	return <Gallery />;
}
