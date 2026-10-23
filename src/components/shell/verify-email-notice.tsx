"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

/**
 * Verify your email (today's sidebar banner). On Home it is a Needs you
 * item, so the notice stays off there (a fact appears once); elsewhere it
 * is the one Notice at the top of the content (docs/ui/GAPS.md §7).
 */
export function VerifyEmailNotice() {
	const t = useTranslations("shell.verifyEmail");
	const toast = useToast();
	const { data: session } = useSession();
	const { data: features } = api.auth.getAppFeatures.useQuery();
	const onHome = usePathname() === "/home";
	const resend = api.auth.resendVerificationEmail.useMutation({
		onSuccess: () => toast.saved(t("sent")),
		onError: (err) => toast.failed(err.message || t("failed")),
	});
	if (
		onHome ||
		!features?.isEmailEnabled ||
		!session?.user ||
		session.user.emailVerified
	)
		return null;
	return (
		<Notice
			action={
				<Button
					kind="secondary"
					loading={resend.isPending}
					onClick={() => resend.mutate()}
					size="sm"
				>
					{t("resend")}
				</Button>
			}
			className="mx-4 mt-4 lg:mx-6"
			tone="attention"
		>
			{t("message")}
		</Notice>
	);
}
