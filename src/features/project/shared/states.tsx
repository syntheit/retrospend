"use client";

import { Link2Off, Lock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";

/**
 * The page for someone without the app shell: no sidebar or tab bar, the
 * same page column and colors as every other page.
 */
export function SharedFrame({ children }: { children: ReactNode }) {
	return (
		<main
			className="bg-bg text-fg flex h-svh flex-col overflow-hidden"
			id="main-content"
		>
			{children}
		</main>
	);
}

/** What a guest or a viewer link keeps in this browser (src/trpc/react.tsx reads them). */
const TOKENS = ["guest_session_token", "guest_project_id", "viewer_link_id"];

/** One state in the page's place: a word, a hint and the way out. */
function Standalone({
	title,
	hint,
	icon,
	forgetTokens = false,
}: {
	title: string;
	hint: string;
	icon: typeof Lock;
	/** Signing in drops the guest and viewer tokens this browser holds. */
	forgetTokens?: boolean;
}) {
	const t = useTranslations("projectShared");
	return (
		<SharedFrame>
			<PageFrame label="project-shared">
				<Empty
					action={
						<Button asChild kind="secondary" size="sm">
							<Link
								href="/login"
								onClick={() => {
									if (!forgetTokens) return;
									for (const key of TOKENS) localStorage.removeItem(key);
								}}
							>
								{t("signIn")}
							</Link>
						</Button>
					}
					className="mt-24"
					hint={hint}
					icon={icon}
					title={title}
				/>
			</PageFrame>
		</SharedFrame>
	);
}

/** Loading: the page's own shape, so nothing jumps when the data arrives. */
export function SharedLoading() {
	return (
		<SharedFrame>
			<PageFrame>
				<div aria-busy="true" className="flex flex-col gap-2">
					<Skeleton className="w-64" shape="line" />
					<Skeleton className="w-40" shape="line" />
				</div>
				<SkeletonRows className="mt-8" count={6} />
			</PageFrame>
		</SharedFrame>
	);
}

/** A public link that is not public, or not a project at all. */
export function PrivateProject() {
	const t = useTranslations("projectShared.private");
	return <Standalone hint={t("hint")} icon={Lock} title={t("title")} />;
}

/** A guest session or invite that no longer works. */
export function LinkExpired({ message }: { message?: string }) {
	const t = useTranslations("projectShared.expired");
	return (
		<Standalone
			forgetTokens
			hint={message ?? t("hint")}
			icon={Link2Off}
			title={t("title")}
		/>
	);
}

/** An invite link that is not valid. */
export function InvalidInvite({ message }: { message?: string }) {
	const t = useTranslations("projectShared.invalidInvite");
	return (
		<Standalone
			hint={message ?? t("hint")}
			icon={Link2Off}
			title={t("title")}
		/>
	);
}
