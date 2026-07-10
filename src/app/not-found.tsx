import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "~/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("notFound");
	return { title: t("pageTitle") };
}

export default async function NotFound() {
	const t = await getTranslations("notFound");
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
			<div className="flex flex-col items-center gap-6">
				<h1 className="font-bold text-7xl text-primary tracking-tight">
					404
				</h1>
				<div className="space-y-1">
					<h2 className="font-semibold text-xl text-foreground">
						{t("heading")}
					</h2>
					<p className="text-muted-foreground">
						{t("description")}
					</p>
				</div>
				<Button asChild className="select-none">
					<Link href="/dashboard">{t("goToDashboard")}</Link>
				</Button>
			</div>
		</div>
	);
}
