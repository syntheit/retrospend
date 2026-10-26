"use client";

import { Mail, UserCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getImageUrl } from "~/lib/image-url";
import { api } from "~/trpc/react";
import { ProjectCover } from "../../projects/project-cover";
import { SharedFrame, SharedLoading } from "./states";
import type { InviteInfo } from "./use-access";

type Ghost = { id: string; name: string; linkable: boolean };

/** One narrow column in the page's place: used by every step of the join. */
function Step({ children }: { children: React.ReactNode }) {
	return (
		<SharedFrame>
			<PageFrame label="project-join">
				<div className="mx-auto mt-16 flex w-full max-w-100 flex-col gap-6">
					{children}
				</div>
			</PageFrame>
		</SharedFrame>
	);
}

/** "Are you one of these people?": pick yourself to keep your history. */
function Chooser({
	info,
	ghosts,
	onPick,
	onNew,
}: {
	info: InviteInfo;
	ghosts: Ghost[];
	onPick: (g: Ghost) => void;
	onNew: () => void;
}) {
	const t = useTranslations("projectShared.chooser");
	return (
		<Step>
			<div className="flex flex-col gap-1">
				<h1 className="text-title text-fg">{t("title")}</h1>
				<p className="text-fg-2 text-body">
					{t("hint", { project: info.projectName })}
				</p>
			</div>
			<ul className="flex flex-col gap-2">
				{ghosts.map((g) => (
					<li key={g.id}>
						<Button
							className="w-full justify-start"
							kind="secondary"
							onClick={() => onPick(g)}
						>
							<Face name={g.name} size="sm" />
							{g.name}
						</Button>
					</li>
				))}
			</ul>
			<Button kind="ghost" onClick={onNew}>
				{t("none")}
			</Button>
		</Step>
	);
}

/** The invite joined an email that was already in: a link went to that address. */
function ResumeSent({ info }: { info: InviteInfo }) {
	const t = useTranslations("projectShared.resume");
	return (
		<Step>
			<Empty
				hint={t("hint", { project: info.projectName })}
				icon={Mail}
				title={t("title")}
			/>
		</Step>
	);
}

/** Joined: one way on, a reload so the next requests carry the new token. */
function Joined({ info, projectId }: { info: InviteInfo; projectId: string }) {
	const t = useTranslations("projectShared.done");
	const roles = useTranslations("projectV2.people.roles");
	return (
		<Step>
			<Empty
				action={
					<Button
						kind="primary"
						onClick={() => window.location.assign(`/projects/${projectId}`)}
					>
						{t("view")}
					</Button>
				}
				hint={t("hint", {
					project: info.projectName,
					role: roles(info.roleGranted as "ORGANIZER"),
				})}
				icon={UserCheck}
				title={t("title")}
			/>
		</Step>
	);
}

/**
 * Joining a project from an invite without an account: the name and email
 * form, with the "are you one of these people?" step first when the project
 * has people nobody has claimed. Joining as someone already in the project
 * hands their history to the new guest session. Joining never re-splits past
 * expenses: that prompt belongs to the owner adding someone.
 */
export function JoinFlow({
	linkId,
	info,
	projectId,
}: {
	linkId: string;
	info: InviteInfo;
	projectId: string;
}) {
	const t = useTranslations("projectShared.join");
	const roles = useTranslations("projectV2.people.roles");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [step, setStep] = useState<"choose" | "form">("form");
	const [ghostId, setGhostId] = useState<string | null>(null);
	const [elsewhere, setElsewhere] = useState<string | null>(null);
	const [opened, setOpened] = useState(false);
	const [done, setDone] = useState<"joined" | "resume" | null>(null);

	const ghosts = api.claim.projectGhosts.useQuery({ linkId });
	// Open on the chooser once, when the project turns out to have unclaimed
	// people; a later refetch never pulls the person back from the form.
	useEffect(() => {
		if (!opened && ghosts.data && ghosts.data.length > 0) {
			setStep("choose");
			setOpened(true);
		}
	}, [opened, ghosts.data]);

	const link = api.claim.linkGuestToGhost.useMutation({
		onSuccess: () => setDone("joined"),
	});
	const register = api.guest.register.useMutation({
		onSuccess: (data) => {
			if (data.resumeEmailSent) {
				setDone("resume");
				return;
			}
			localStorage.setItem("guest_session_token", data.sessionToken);
			localStorage.setItem("guest_project_id", data.projectId);
			if (ghostId)
				link.mutate({
					linkId,
					guestSessionId: data.guestSessionId,
					shadowId: ghostId,
				});
			else setDone("joined");
		},
	});

	const pick = (g: Ghost) => {
		// A person who is also in other projects cannot be taken over by a guest.
		setGhostId(g.linkable ? g.id : null);
		setElsewhere(g.linkable ? null : g.name);
		setName(g.name);
		setStep("form");
	};
	const asNew = () => {
		setGhostId(null);
		setElsewhere(null);
		setName("");
		setStep("form");
	};
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !email.trim()) return;
		register.mutate({ linkId, name: name.trim(), email: email.trim() });
	};

	if (done === "resume") return <ResumeSent info={info} />;
	if (done === "joined") return <Joined info={info} projectId={projectId} />;
	if (ghosts.isLoading) return <SharedLoading />;
	if (step === "choose" && ghosts.data && ghosts.data.length > 0)
		return (
			<Chooser
				ghosts={ghosts.data}
				info={info}
				onNew={asNew}
				onPick={pick}
			/>
		);

	const busy = register.isPending || link.isPending;
	const failed = register.isError || link.isError;
	const cover = getImageUrl(info.projectImagePath);
	return (
		<Step>
			<div className="flex items-center gap-3">
				{cover ? (
					<span
						aria-hidden="true"
						className="rounded-ctl bg-raised flex size-12 shrink-0 overflow-hidden *:size-full"
					>
						<ProjectCover src={cover} />
					</span>
				) : null}
				<div className="min-w-0">
					<h1 className="text-title text-fg truncate">
						{t("title", { project: info.projectName })}
					</h1>
					<p className="text-fg-3 text-small">
						{t("sub", {
							count: info.participantCount,
							role: roles(info.roleGranted as "ORGANIZER"),
						})}
					</p>
				</div>
			</div>
			{ghosts.data && ghosts.data.length > 0 ? (
				<Button
					className="self-start"
					kind="ghost"
					onClick={() => setStep("choose")}
					size="sm"
				>
					{t("back")}
				</Button>
			) : null}
			{elsewhere ? (
				<p className="text-fg-2 text-small">
					{t("elsewhere", { name: elsewhere })}
				</p>
			) : null}
			<form className="flex flex-col gap-4" onSubmit={submit}>
				<div className="flex flex-col gap-1">
					<Label htmlFor="join-name">{t("name")}</Label>
					<Input
						autoComplete="name"
						autoFocus
						id="join-name"
						onChange={(e) => setName(e.target.value)}
						required
						value={name}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="join-email">{t("email")}</Label>
					<Input
						autoComplete="email"
						id="join-email"
						onChange={(e) => setEmail(e.target.value)}
						required
						type="email"
						value={email}
					/>
					<span className="text-fg-3 text-meta">{t("emailHint")}</span>
				</div>
				{failed ? (
					<p className="text-danger text-small" role="alert">
						{t("failed")}
					</p>
				) : null}
				<Button
					disabled={!name.trim() || !email.trim() || busy}
					kind="primary"
					type="submit"
				>
					{busy ? t("joining") : t("submit")}
				</Button>
			</form>
			<p className="text-fg-3 text-small">
				{t.rich("haveAccount", {
					link: (chunks) => (
						<Link
							className="text-accent-strong can-hover:hover:underline font-medium"
							href="/login"
						>
							{chunks}
						</Link>
					),
				})}
			</p>
		</Step>
	);
}
