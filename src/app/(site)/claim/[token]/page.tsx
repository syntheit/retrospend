"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
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

	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				className="flex flex-col items-center justify-center space-y-6 py-6"
				description={t("subtitle")}
				title={t("title")}
			>
				{(infoQuery.isLoading || sessionPending) && (
					<>
						<Loader2 className="text-primary h-12 w-12 animate-spin" />
						<p className="text-muted-foreground text-sm">{t("loading")}</p>
					</>
				)}

				{infoQuery.isError && (
					<>
						<div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
							<AlertCircle className="text-destructive h-12 w-12" />
						</div>
						<p className="text-muted-foreground text-center text-sm">
							{infoQuery.error.message}
						</p>
						<Button asChild className="w-full" variant="outline">
							<Link href="/">{t("returnHome")}</Link>
						</Button>
					</>
				)}

				{infoQuery.data?.alreadyClaimed && (
					<>
						<div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/30">
							<AlertCircle className="h-12 w-12 text-amber-600 dark:text-amber-500" />
						</div>
						<p className="text-muted-foreground text-center text-sm">
							{t("alreadyClaimed")}
						</p>
						<Button asChild className="w-full" variant="outline">
							<Link href="/">{t("returnHome")}</Link>
						</Button>
					</>
				)}

				{infoQuery.data &&
					!infoQuery.data.alreadyClaimed &&
					!sessionPending && (
						<>
							<div className="space-y-2 text-center">
								<p className="text-lg">
									{t.rich("isThisYou", {
										name: infoQuery.data.name,
										strong: (chunks) => (
											<span className="text-foreground font-semibold">
												{chunks}
											</span>
										),
									})}
								</p>
								{infoQuery.data.projects.length > 0 && (
									<p className="text-muted-foreground text-sm">
										{t("addedTo", {
											projects: infoQuery.data.projects
												.map((p) => p.name)
												.join(", "),
										})}
									</p>
								)}
							</div>

							{claimMutation.isError && (
								<p className="text-destructive text-center text-sm">
									{claimMutation.error.message}
								</p>
							)}

							{session?.user ? (
								<div className="flex w-full flex-col gap-2">
									<Button
										className="w-full gap-2"
										disabled={claimMutation.isPending}
										onClick={() => claimMutation.mutate({ token })}
									>
										{claimMutation.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<CheckCircle2 className="h-4 w-4" />
										)}
										{t("confirmThisIsMe")}
									</Button>
									<Button asChild className="w-full" variant="ghost">
										<Link href="/">{t("notMe")}</Link>
									</Button>
								</div>
							) : (
								<div className="flex w-full flex-col gap-2">
									<p className="text-muted-foreground text-center text-sm">
										{t("createAccountToClaim")}
									</p>
									<Button asChild className="w-full gap-2">
										<Link
											href={`/signup?redirect=${encodeURIComponent(redirectTarget)}`}
										>
											{t("createAccount")}
											<ArrowRight className="h-4 w-4" />
										</Link>
									</Button>
									<p className="text-muted-foreground text-center text-xs">
										{t.rich("alreadyHaveAccount", {
											link: (chunks) => (
												<Link
													className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
													href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
												>
													{chunks}
												</Link>
											),
										})}
									</p>
								</div>
							)}
						</>
					)}
			</AuthPanel>
		</div>
	);
}
