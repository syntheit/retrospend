"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { StatusDot } from "~/components/ui/status-dot";
import { useToast } from "~/components/ui/toast";
import { env } from "~/env";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { SectionShell, SkeletonRowsFor } from "../section-shell";
import { SettingRow, SettingRows } from "../setting-row";
import { AvatarRow } from "./avatar-row";
import { BackgroundSheet } from "./background-sheet";
import { EmailSheet } from "./email-sheet";
import { NameFields, type ProfileIdentity } from "./name-fields";

type SessionUser = { username?: string; emailVerified?: boolean };

/** The public profile URL for a username, on this server. */
export function profileUrl(origin: string, username: string): string {
	return `${origin.replace(/\/$/, "")}/u/${username}`;
}

/**
 * Profile: picture, name and username (autosave), email with its own
 * Change email sheet, and the public profile row (Copy link, View, and the
 * Background sheet). A pending email change shows as one Notice.
 */
export function ProfileSection() {
	const t = useTranslations("settingsV2.profile");
	const toast = useToast();
	const { data: session, refetch } = useSession();
	const { data: features } = api.auth.getAppFeatures.useQuery();
	const pending = api.profile.getPendingEmail.useQuery();
	const utils = api.useUtils();
	const cancel = api.profile.cancelPendingEmailChange.useMutation();
	const [sheet, setSheet] = useState<"email" | "background" | null>(null);
	// The configured URL on the server render, this tab's origin after it.
	const [origin, setOrigin] = useState(env.NEXT_PUBLIC_APP_URL ?? "");
	useEffect(() => setOrigin(window.location.origin), []);

	const user = session?.user as
		| (NonNullable<typeof session>["user"] & SessionUser)
		| undefined;
	if (!user) {
		return (
			<SectionShell id="profile" title={t("title")}>
				<SkeletonRowsFor count={3} />
			</SectionShell>
		);
	}
	const identity: ProfileIdentity = {
		name: user.name,
		username: user.username ?? "",
		email: user.email,
	};
	const link = profileUrl(origin, identity.username);
	const shownLink = link.replace(/^https?:\/\//, "");
	const pendingEmail = pending.data?.pendingEmail ?? null;
	const unverified = features?.isEmailEnabled && !user.emailVerified;

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(link);
			toast.info(t("linkCopied"));
		} catch {
			toast.failed(t("copyFailed"));
		}
	};
	const cancelChange = async () => {
		try {
			await cancel.mutateAsync();
			await utils.profile.getPendingEmail.invalidate();
			toast.saved(t("emailChangeCanceled"));
		} catch {
			toast.failed(t("emailCancelFailed"));
		}
	};

	return (
		<SectionShell id="profile" title={t("title")}>
			<AvatarRow fallbackName={identity.name} />
			<NameFields identity={identity} onSaved={refetch} />
			<SettingRows className="mt-2">
				<SettingRow
					label={t("email")}
					meta={
						<span className="inline-flex flex-wrap items-center gap-2">
							{identity.email}
							{unverified && (
								<StatusDot kind="review" label={t("unverified")} size="sm" />
							)}
						</span>
					}
				>
					<Button
						disabled={!!pendingEmail}
						kind="secondary"
						onClick={() => setSheet("email")}
						size="sm"
					>
						{t("changeEmail")}
					</Button>
				</SettingRow>
				{/* One line on phones too (mockup): the address itself opens the profile. */}
				<SettingRow
					className="max-md:flex-nowrap"
					label={t("publicProfile")}
					meta={
						<a
							aria-label={`${t("viewProfile")} ${shownLink}`}
							className="block max-w-full truncate rounded-ctl font-medium text-accent-strong text-meta focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:underline"
							href={`/u/${identity.username}`}
							rel="noopener"
							target="_blank"
						>
							{shownLink}
						</a>
					}
				>
					<Button kind="secondary" onClick={() => void copyLink()} size="sm">
						{t("copyLink")}
					</Button>
					<Button
						kind="secondary"
						onClick={() => setSheet("background")}
						size="sm"
					>
						{t("background")}
					</Button>
				</SettingRow>
			</SettingRows>
			{pendingEmail && (
				<Notice
					action={
						<Button
							kind="secondary"
							loading={cancel.isPending}
							onClick={() => void cancelChange()}
							size="sm"
						>
							{t("cancelChange")}
						</Button>
					}
					className="mt-3"
				>
					{t("pendingEmail", { email: pendingEmail })}
				</Notice>
			)}
			<EmailSheet
				current={identity}
				onChanged={refetch}
				onOpenChange={(o) => setSheet(o ? "email" : null)}
				open={sheet === "email"}
			/>
			<BackgroundSheet
				onOpenChange={(o) => setSheet(o ? "background" : null)}
				open={sheet === "background"}
				seed={identity.username || "preview"}
			/>
		</SectionShell>
	);
}
