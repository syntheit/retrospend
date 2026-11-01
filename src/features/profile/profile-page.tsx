"use client";

import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BackButton, PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/layout/section";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { useToast } from "~/components/ui/toast";
import { env } from "~/env";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import { useSession } from "~/hooks/use-session";
import { entryOf, settingsHref } from "~/lib/nav";
import { api } from "~/trpc/react";
import { AvatarRow } from "./avatar-row";
import { BackgroundSheet } from "./background-sheet";
import { EmailSheet } from "./email-sheet";
import { NameFields, type ProfileIdentity } from "./name-fields";

type SessionUser = {
	username?: string;
	emailVerified?: boolean;
	createdAt?: Date | string;
};

/** The public profile URL for a username, on this server. */
export function profileUrl(origin: string, username: string): string {
	return `${origin.replace(/\/$/, "")}/u/${username}`;
}

/**
 * Your profile: the picture, name, username and email, the public page
 * (link, who can see it, the background) and the way to Security and
 * Sessions in Settings. Name and username save when you leave the field,
 * the same as they did in Settings, where they no longer live.
 */
export function ProfilePage() {
	const t = useTranslations("profilePage");
	const ts = useTranslations("settingsV2.profile");
	const tb = useTranslations("settingsV2.background");
	const format = useFormatter();
	const toast = useToast();
	const { data: session, refetch } = useSession();
	const { data: features } = api.auth.getAppFeatures.useQuery();
	const pending = api.profile.getPendingEmail.useQuery();
	const background = api.profile.getBackgroundSettings.useQuery();
	const utils = api.useUtils();
	const cancel = api.profile.cancelPendingEmailChange.useMutation();
	const [sheet, setSheet] = useState<"email" | "background" | null>(null);
	// The configured URL on the server render, this tab's origin after it.
	const [origin, setOrigin] = useState(env.NEXT_PUBLIC_APP_URL ?? "");
	useEffect(() => setOrigin(window.location.origin), []);

	const user = session?.user as
		| (NonNullable<typeof session>["user"] & SessionUser)
		| undefined;
	const username = user?.username ?? "";
	const publicProfile = api.profile.publicProfile.useQuery(
		{ username },
		{ enabled: username !== "" },
	);
	const home = entryOf("home").href;

	if (!user) {
		return (
			<PageFrame label="profile">
				<PageHeader
					lead={<BackButton href={home} label={t("back")} />}
					title={t("title")}
				/>
				<div className="flex max-w-160 flex-col gap-4">
					<Skeleton className="size-16 rounded-full" shape="face" />
					<Skeleton className="h-ctl w-full" shape="line" />
					<Skeleton className="h-ctl w-full" shape="line" />
				</div>
			</PageFrame>
		);
	}

	const identity: ProfileIdentity = {
		name: user.name,
		username,
		email: user.email,
	};
	const link = profileUrl(origin, username);
	const shownLink = link.replace(/^https?:\/\//, "");
	const pendingEmail = pending.data?.pendingEmail ?? null;
	const unverified = features?.isEmailEnabled && !user.emailVerified;
	const since = user.createdAt
		? format.dateTime(new Date(user.createdAt), {
				month: "long",
				year: "numeric",
			})
		: null;
	const methods =
		publicProfile.data && "publicMethods" in publicProfile.data
			? (publicProfile.data.publicMethods?.length ?? null)
			: null;
	const bg = background.data;

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(link);
			toast.info(ts("linkCopied"));
		} catch {
			toast.failed(ts("copyFailed"));
		}
	};
	const cancelChange = async () => {
		try {
			await cancel.mutateAsync();
			await utils.profile.getPendingEmail.invalidate();
			toast.saved(ts("emailChangeCanceled"));
		} catch {
			toast.failed(ts("emailCancelFailed"));
		}
	};

	return (
		<PageFrame label="profile">
			<PageHeader
				lead={<BackButton href={home} label={t("back")} />}
				title={t("title")}
			/>
			<div className="max-w-160">
				<AvatarRow fallbackName={identity.name} />

				<Section className="mt-8" title={t("details")}>
					<NameFields identity={identity} onSaved={refetch} />
					<SettingRows className="mt-2">
						<SettingRow
							label={ts("email")}
							meta={
								<span className="inline-flex flex-wrap items-center gap-2">
									{identity.email}
									{unverified && (
										<StatusDot
											kind="review"
											label={ts("unverified")}
											size="sm"
										/>
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
								{ts("changeEmail")}
							</Button>
						</SettingRow>
						{since && (
							<SettingRow label={t("memberSince")}>
								<span className="text-body text-fg tabular-nums">{since}</span>
							</SettingRow>
						)}
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
									{ts("cancelChange")}
								</Button>
							}
							className="mt-3"
						>
							{ts("pendingEmail", { email: pendingEmail })}
						</Notice>
					)}
				</Section>

				<Section className="mt-8" title={t("publicSection")}>
					<SettingRows>
						<SettingRow
							className="max-md:flex-nowrap"
							label={ts("publicProfile")}
							meta={
								<a
									aria-label={`${ts("viewProfile")} ${shownLink}`}
									className="block max-w-full truncate rounded-ctl font-medium text-accent-strong text-meta focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:underline"
									href={`/u/${username}`}
									rel="noopener"
									target="_blank"
								>
									{shownLink}
								</a>
							}
						>
							<Button
								kind="secondary"
								onClick={() => void copyLink()}
								size="sm"
							>
								{ts("copyLink")}
							</Button>
						</SettingRow>
						<SettingRow label={t("visibility")}>
							<span className="text-body text-fg">{t("visibilityValue")}</span>
						</SettingRow>
						<SettingRow label={t("paymentMethods")}>
							<span className="text-body text-fg tabular-nums">
								{methods === null ? "" : t("paymentMethodsCount", { count: methods })}
							</span>
						</SettingRow>
						<SettingRow
							label={t("background")}
							meta={
								bg
									? t("backgroundSummary", {
											symbols: bg.symbolSets
												.map((s) => tb(`symbol.${s}`))
												.join(", "),
											color: tb(`colors.${bg.color}`),
										})
									: undefined
							}
						>
							<Button
								kind="secondary"
								onClick={() => setSheet("background")}
								size="sm"
							>
								{t("edit")}
							</Button>
						</SettingRow>
					</SettingRows>
				</Section>

				<Section className="mt-8" title={t("accountSection")}>
					<SettingRows>
						<SettingRow label={t("security")}>
							<Button asChild kind="secondary" size="sm">
								<Link href={settingsHref("security")}>{t("open")}</Link>
							</Button>
						</SettingRow>
						<SettingRow label={t("sessions")}>
							<Button asChild kind="secondary" size="sm">
								<Link href={settingsHref("security")}>{t("open")}</Link>
							</Button>
						</SettingRow>
					</SettingRows>
				</Section>
			</div>

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
		</PageFrame>
	);
}
