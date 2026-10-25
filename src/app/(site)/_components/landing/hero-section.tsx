"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { useSession } from "~/hooks/use-session";

export function HeroSection() {
	const { data: session, isPending } = useSession();
	const isLoggedIn = !isPending && !!session?.user;
	const t = useTranslations("landing");

	return (
		<section className="py-24 lg:py-32">
			<div className="relative mx-auto max-w-3xl text-center">
				<h1 className="text-fg text-hero">Retrospend</h1>
				<p className="text-fg-2 text-section mt-4">{t("heroTagline")}</p>
				<p className="text-fg-3 text-body mx-auto mt-4 max-w-xl">
					{t("heroDescription")}
				</p>
				{!isPending && (
					<div className="mt-10 flex items-center justify-center gap-4">
						{isLoggedIn ? (
							<Button asChild kind="primary">
								<Link href="/home">{t("goToDashboard")}</Link>
							</Button>
						) : (
							<>
								<Button asChild kind="primary">
									<Link href="/signup">{t("getStarted")}</Link>
								</Button>
								<Button asChild kind="secondary">
									<Link href="/login">{t("login")}</Link>
								</Button>
							</>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
