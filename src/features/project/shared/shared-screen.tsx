"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { PageTabs } from "~/components/ui/page-tabs";
import { ProjectCover } from "~/features/projects/project-cover";
import { api } from "~/trpc/react";
import { useProjectSub } from "../project-header";
import { ProjectHero } from "../project-hero";
import { type PageView, type ProjectTab, tabOf } from "../types";
import { GuestAddSheet } from "./guest-add-sheet";
import {
	SharedExpenses,
	SharedPeople,
	SharedSummary,
} from "./shared-panes";
import {
	LinkExpired,
	PrivateProject,
	SharedFrame,
	SharedLoading,
} from "./states";

export type SharedAccess = "guest" | "viewer" | "public";

const CONTRIBUTORS = ["CONTRIBUTOR", "EDITOR", "ORGANIZER"];

/** The sign up link of a guest, who keeps their name (the upgrade flow reads it). */
function signUpHref(name: string | null) {
	const params = new URLSearchParams({ upgrade: "true" });
	if (name) params.set("name", name);
	return `/signup?${params.toString()}`;
}

function SharedHeader({
	view,
	tab,
	me,
	access,
	canAdd,
	onAdd,
}: {
	view: PageView;
	tab: ProjectTab;
	me: string;
	access: SharedAccess;
	canAdd: boolean;
	onAdd: () => void;
}) {
	const t = useTranslations("projectV2");
	const ts = useTranslations("projectShared");
	const sub = useProjectSub(view);
	const base = `/projects/${view.id}`;
	const tabs = [
		{ id: "expenses", href: base, label: t("tabs.expenses") },
		{ id: "summary", href: `${base}?tab=summary`, label: t("tabs.summary") },
		...(view.solo || access === "public"
			? []
			: [
					{ id: "people", href: `${base}?tab=people`, label: t("tabs.people") },
				]),
	];
	return (
		<PageHeader
			faces={
				view.solo ? undefined : (
					<FaceStack
						people={view.members.map((m) => ({
							id: m.id,
							name: m.name,
							imageUrl: m.imageUrl,
							isSelf: m.id === me,
						}))}
					/>
				)
			}
			lead={
				view.imageUrl ? (
					<span
						aria-hidden="true"
						className="rounded-ctl bg-raised flex size-10 shrink-0 overflow-hidden *:size-full"
					>
						<ProjectCover src={view.imageUrl} />
					</span>
				) : undefined
			}
			primary={
				canAdd ? (
					<Button kind="primary" onClick={onAdd}>
						<Plus aria-hidden="true" />
						{t("addExpense")}
					</Button>
				) : (
					<Button asChild kind="primary">
						<Link href="/login">{ts("signIn")}</Link>
					</Button>
				)
			}
			sub={sub}
			tabs={<PageTabs current={tab} items={tabs} />}
			title={view.name}
		/>
	);
}

/** The one line that says how this page is being read. */
function SharedNotice({
	access,
	name,
}: {
	access: SharedAccess;
	name: string | null;
}) {
	const t = useTranslations("projectShared.notice");
	const text =
		access === "guest"
			? t("guest", { name: name ?? "" })
			: access === "viewer"
				? t("viewer")
				: t("public");
	return (
		<Notice
			action={
				<Button asChild kind="secondary" size="sm">
					<Link href={signUpHref(name)}>{t("create")}</Link>
				</Button>
			}
			className="mb-6"
		>
			{text}
		</Notice>
	);
}

/**
 * The project page for a guest, a viewer link or the public: the same header,
 * hero and tabs as a member's page, read only. A guest sees their own
 * balances and, with the right role, can add an expense. A viewer link and
 * the public never see balances; the public page has no People tab and no
 * payments either. Members of the project never come here: the server
 * renders their page.
 */
export function SharedScreen({
	id,
	access,
	onViewerFailed,
}: {
	id: string;
	access: SharedAccess;
	/** A viewer link that stopped working. */
	onViewerFailed: () => void;
}) {
	const params = useSearchParams();
	const utils = api.useUtils();
	const [adding, setAdding] = useState(false);
	const isPublic = access === "public";
	const own = api.project.sharedPageView.useQuery(
		{ id },
		{ enabled: !isPublic, retry: false },
	);
	const open = api.project.publicPageView.useQuery(
		{ id },
		{ enabled: isPublic, retry: false },
	);
	const view = isPublic ? open.data : own.data;
	const summary = api.project.summary.useQuery(
		{ projectId: id },
		// A viewer link is refused the money between people, as the public is.
		{ enabled: access === "guest" && !!view && !view.solo, retry: false },
	);
	useEffect(() => {
		if (access === "viewer" && own.isError) onViewerFailed();
	}, [access, own.isError, onViewerFailed]);

	if ((isPublic ? open : own).isPending) return <SharedLoading />;
	if (isPublic && !view) return <PrivateProject />;
	if (!view) return access === "viewer" ? <SharedLoading /> : <LinkExpired />;

	const me = view.members.find((m) => m.isMe);
	const tab = tabOf(params.get("tab"), view.solo);
	const shown = tab === "people" && isPublic ? "expenses" : tab;
	const canAdd =
		access === "guest" &&
		view.status !== "ARCHIVED" &&
		CONTRIBUTORS.includes(view.myRole ?? "");
	const changed = () => {
		void utils.project.sharedPageView.invalidate({ id });
		void utils.project.summary.invalidate({ projectId: id });
	};
	return (
		<SharedFrame>
			<PageFrame label="project-shared">
				<SharedHeader
					access={access}
					canAdd={canAdd}
					me={me?.id ?? ""}
					onAdd={() => setAdding(true)}
					tab={shown}
					view={view}
				/>
				<SharedNotice access={access} name={me?.name ?? null} />
				<ProjectHero me={me?.id ?? ""} view={view} />
				{shown === "expenses" ? (
					<SharedExpenses me={me?.id ?? ""} view={view} />
				) : null}
				{shown === "summary" ? (
					<SharedSummary
						byCategoryOnly={access !== "guest"}
						me={me?.id ?? ""}
						summary={summary.data}
						view={view}
					/>
				) : null}
				{shown === "people" ? <SharedPeople view={view} /> : null}
				{adding ? (
					<GuestAddSheet
						onChanged={changed}
						onOpenChange={(o) => setAdding(o)}
						view={view}
					/>
				) : null}
			</PageFrame>
		</SharedFrame>
	);
}
