"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { ResetFlow } from "~/features/recovery/reset-flow";

function ResetPasswordInner() {
	const t = useTranslations("auth");
	const token = useSearchParams().get("token");

	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{token ? (
				<ResetFlow token={token} />
			) : (
				<AuthPanel
					description={t("noResetTokenProvided")}
					title={t("invalidLink")}
					tone="danger"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/login">{t("returnToLogin")}</Link>
					</Button>
				</AuthPanel>
			)}
		</div>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense
			fallback={
				<div className="bg-bg flex min-h-screen items-center justify-center px-4">
					<div className="flex w-full max-w-md items-center justify-center p-12">
						<Loader2 className="text-fg-3 size-8 animate-spin" />
					</div>
				</div>
			}
		>
			<ResetPasswordInner />
		</Suspense>
	);
}
