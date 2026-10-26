"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export default function ClaimPage() {
	const params = useParams<{ token: string }>();
	const token = params.token;
	const t = useTranslations("claim");
	const router = useRouter();
	const { data: session, isPending: sessionPending } = useSession();

	const infoQuery = api.claim.info.useQuery(
		{ token },
		{ enabled: Boolean(token), retry: false },
	);

	const claimMutation = api.claim.claimByToken.useMutation({
		onSuccess: () => {
			// Send them to the project(s) they now belong to.
			router.push("/projects");
		},
	});

	const redirectTarget = `/claim/${token}`;

	const loading = infoQuery.isLoading || sessionPending;
	const data = infoQuery.data;
	const link =
		"text-accent-strong rounded-ctl focus-visible:outline-brand can-hover:hover:underline font-medium focus-visible:outline-2 focus-visible:outline-offset-2";

	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{loading ? (
				<AuthPanel busy description={t("loading")} title={t("title")} />
			) : infoQuery.isError ? (
				<AuthPanel
					description={infoQuery.error.message}
					title={t("title")}
					tone="danger"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/">{t("returnHome")}</Link>
					</Button>
				</AuthPanel>
			) : data?.alreadyClaimed ? (
				<AuthPanel
					description={t("alreadyClaimed")}
					title={t("title")}
					tone="attention"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/">{t("returnHome")}</Link>
					</Button>
				</AuthPanel>
			) : data ? (
				<AuthPanel
					className="flex flex-col gap-4"
					description={t("subtitle")}
					title={t("title")}
				>
					<div className="text-center">
						<p className="text-fg text-section">
							{t.rich("isThisYou", {
								name: data.name,
								strong: (chunks) => (
									<span className="font-semibold">{chunks}</span>
								),
							})}
						</p>
						{data.projects.length > 0 && (
							<p className="text-fg-2 text-small mt-1">
								{t("addedTo", {
									projects: data.projects.map((p) => p.name).join(", "),
								})}
							</p>
						)}
					</div>

					{claimMutation.isError && (
						<p className="text-danger text-small text-center" role="alert">
							{claimMutation.error.message}
						</p>
					)}

					{session?.user ? (
						<div className="flex w-full flex-col gap-2">
							<Button
								className="w-full"
								disabled={claimMutation.isPending}
								kind="primary"
								loading={claimMutation.isPending}
								onClick={() => claimMutation.mutate({ token })}
							>
								{t("confirmThisIsMe")}
							</Button>
							<Button asChild className="w-full" kind="ghost">
								<Link href="/">{t("notMe")}</Link>
							</Button>
						</div>
					) : (
						<div className="flex w-full flex-col gap-2">
							<p className="text-fg-2 text-small text-center">
								{t("createAccountToClaim")}
							</p>
							<Button asChild className="w-full" kind="primary">
								<Link
									href={`/signup?redirect=${encodeURIComponent(redirectTarget)}`}
								>
									{t("createAccount")}
								</Link>
							</Button>
							<p className="text-fg-3 text-small text-center">
								{t.rich("alreadyHaveAccount", {
									link: (chunks) => (
										<Link
											className={link}
											href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
										>
											{chunks}
										</Link>
									),
								})}
							</p>
						</div>
					)}
				</AuthPanel>
			) : null}
		</div>
	);
}
