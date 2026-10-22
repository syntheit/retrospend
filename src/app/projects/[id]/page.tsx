"use client";

import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Link2,
	Link2Off,
	Loader2,
	Lock,
	LogIn,
	Mail,
	Plus,
	Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { usePageTitle } from "~/hooks/use-page-title";
import { BillingPeriodTabs } from "~/components/project/billing-period-tabs";
import { BudgetCard } from "~/components/project/budget-card";
import { ExpensesTable } from "~/components/project/expenses-table";
import { ParticipantRow, ProjectHeader } from "~/components/project/project-header";
import { ProjectTabs } from "~/components/project/project-tabs";
import { ProjectSettingsDialog } from "~/components/project/project-settings-dialog";
import { ProjectVisual } from "~/components/project/project-visual";
import { CommandPalette } from "~/components/command-palette";
import { DashboardLayout } from "~/components/dashboard-layout";
import { ExpenseModalProvider, useExpenseModal } from "~/components/expense-modal-provider";
import { ExpenseModal } from "~/components/expense-modal";
import { RecurringModalProvider } from "~/components/recurring-modal-provider";
import { RevisionHistoryProvider } from "~/components/revision-history-provider";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { DataTable } from "~/components/data-table";
import {
	type ProjectExpense,
	createProjectExpenseColumns,
} from "~/components/project/expenses-table-columns";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useSession } from "~/hooks/use-session";
import { cn, downloadCsv, downloadPdf } from "~/lib/utils";
import { api } from "~/trpc/react";

// -- Types --------------------------------------------------------------------

type AccessMode =
	| "resolving"
	| "invite-error"
	| "invite-join"
	| "authenticated"
	| "guest"
	| "viewer"
	| "public"
	| "private";

type PageParams = Promise<{ id: string }>;

// -- Main Page ----------------------------------------------------------------

export default function UnifiedProjectPage({ params }: { params: PageParams }) {
	const { id } = use(params);
	const searchParams = useSearchParams();
	const router = useRouter();
	const inviteLinkId = searchParams.get("invite");
	const guestResumeToken = searchParams.get("guestResume");
	const tClaim = useTranslations("claim");
	const tPage = useTranslations("projectPage");

	// Resume link from the "you already joined" email: trade it for a fresh
	// guest session token, then reload into the guest view. The ref keeps it to
	// one call (the token is single-use) even if the effect runs twice.
	const resumeMutation = api.guest.resume.useMutation();
	const resumeStarted = useRef(false);
	const [resumeFailed, setResumeFailed] = useState(false);
	useEffect(() => {
		if (!guestResumeToken || resumeStarted.current) return;
		resumeStarted.current = true;
		resumeMutation.mutate(
			{ token: guestResumeToken },
			{
				onSuccess: (data) => {
					localStorage.setItem("guest_session_token", data.sessionToken);
					localStorage.setItem("guest_project_id", data.projectId);
					window.location.replace(`/projects/${data.projectId}`);
				},
				onError: () => setResumeFailed(true),
			},
		);
	}, [guestResumeToken, resumeMutation]);

	const [accessMode, setAccessMode] = useState<AccessMode>("resolving");
	const [inviteHandled, setInviteHandled] = useState(!inviteLinkId);
	const [inviteErrorMessage, setInviteErrorMessage] = useState<string | null>(null);

	// Session check
	const { data: session, isPending: sessionPending } = useSession();

	// Signed-in users join through the invite with their own account. The ref
	// keeps it to one call even if the effect below runs again.
	const joinWithAccount = api.guest.joinWithAccount.useMutation();
	const joinStarted = useRef(false);

	// Invite link validation
	const {
		data: linkInfo,
		isLoading: linkLoading,
		isError: linkError,
	} = api.guest.validateLink.useQuery(
		{ linkId: inviteLinkId! },
		{ enabled: !!inviteLinkId && !inviteHandled, retry: false },
	);

	// Handle invite link
	useEffect(() => {
		if (!inviteLinkId || inviteHandled) return;
		if (linkLoading) return;

		if (linkError || !linkInfo) {
			setAccessMode("invite-error");
			return;
		}

		// Reject invite links that belong to a different project
		if (linkInfo.projectId !== id) {
			setInviteErrorMessage(tPage("inviteForOtherProject"));
			setAccessMode("invite-error");
			return;
		}

		if (linkInfo.roleGranted === "VIEWER") {
			// VIEWER: silently store and continue
			localStorage.setItem("viewer_link_id", inviteLinkId);
			stripInviteParam();
			setInviteHandled(true);
			return;
		}

		// Non-VIEWER: wait for the session so a signed-in user isn't shown the
		// guest form while it loads.
		if (sessionPending) return;
		if (session?.user) {
			// Signed-in user: join with their own account (the server only adds
			// the account behind this session), then continue as authenticated.
			if (joinStarted.current) return;
			joinStarted.current = true;
			joinWithAccount.mutate(
				{ linkId: inviteLinkId },
				{
					onSuccess: () => {
						stripInviteParam();
						setInviteHandled(true);
					},
					onError: (err) => {
						setInviteErrorMessage(err.message);
						setAccessMode("invite-error");
					},
				},
			);
			return;
		}

		// Check for existing guest token for this project
		const guestToken = localStorage.getItem("guest_session_token");
		const guestProjectId = localStorage.getItem("guest_project_id");
		if (guestToken && guestProjectId === id) {
			stripInviteParam();
			setInviteHandled(true);
			return;
		}

		// Show join form
		setAccessMode("invite-join");
	}, [inviteLinkId, inviteHandled, linkLoading, linkError, linkInfo, session, sessionPending, joinWithAccount, id, tPage]);

	// Access resolution (after invite is handled or if no invite)
	useEffect(() => {
		if (!inviteHandled) return;
		if (sessionPending) return;

		if (session?.user) {
			setAccessMode("authenticated");
			return;
		}

		// Check guest token
		const guestToken = localStorage.getItem("guest_session_token");
		const guestProjectId = localStorage.getItem("guest_project_id");
		if (guestToken && guestProjectId === id) {
			setAccessMode("guest");
			return;
		}

		// Check viewer link
		const viewerLinkId = localStorage.getItem("viewer_link_id");
		if (viewerLinkId) {
			setAccessMode("viewer");
			return;
		}

		// No auth - try public
		setAccessMode("public");
	}, [inviteHandled, sessionPending, session, id]);

	function stripInviteParam() {
		const url = new URL(window.location.href);
		url.searchParams.delete("invite");
		window.history.replaceState({}, "", url.toString());
	}

	// ── Render based on access mode ──

	if (guestResumeToken) {
		return resumeFailed ? (
			<InviteErrorView message={tClaim("resumeLinkInvalid")} />
		) : (
			<LoadingScreen />
		);
	}

	if (accessMode === "resolving") {
		return <LoadingScreen />;
	}

	if (accessMode === "invite-error") {
		return <InviteErrorView message={inviteErrorMessage ?? undefined} />;
	}

	if (accessMode === "invite-join" && linkInfo) {
		return (
			<InviteJoinView
				linkId={inviteLinkId!}
				linkInfo={linkInfo}
				projectId={id}
				onComplete={() => {
					stripInviteParam();
					setInviteHandled(true);
				}}
			/>
		);
	}

	if (accessMode === "authenticated") {
		return (
			<ExpenseModalProvider>
				<RecurringModalProvider>
					<RevisionHistoryProvider>
						<DashboardLayout>
							<AuthenticatedProjectView
								id={id}
								onFallbackToPublic={() => setAccessMode("public")}
							/>
						</DashboardLayout>
						<CommandPalette />
					</RevisionHistoryProvider>
				</RecurringModalProvider>
			</ExpenseModalProvider>
		);
	}

	if (accessMode === "guest") {
		return <GuestProjectView id={id} />;
	}

	if (accessMode === "viewer") {
		return <ViewerProjectView id={id} />;
	}

	if (accessMode === "public") {
		return <PublicProjectView id={id} />;
	}

	return <PrivateProjectView />;
}

// ── Loading ──────────────────────────────────────────────────────────────────

function LoadingScreen() {
	const t = useTranslations("projectPage");
	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="flex flex-col items-center gap-3">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				<p className="text-muted-foreground text-sm">{t("loadingProject")}</p>
			</div>
		</div>
	);
}

// ── Invite Error ─────────────────────────────────────────────────────────────

function InviteErrorView({ message }: { message?: string }) {
	const t = useTranslations("projectPage");
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
						<Link2 className="h-8 w-8 text-destructive" />
					</div>
					<h1 className="font-bold text-xl">{t("invalidInviteTitle")}</h1>
					<p className="text-muted-foreground text-sm">
						{message ?? t("invalidInviteDescription")}
					</p>
					<Button asChild variant="outline">
						<Link href="/login">
							<LogIn className="mr-2 h-4 w-4" />
							{t("logIn")}
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Invite Join Flow ─────────────────────────────────────────────────────────

function InviteJoinView({
	linkId,
	linkInfo,
	projectId,
	onComplete,
}: {
	linkId: string;
	linkInfo: {
		projectId: string;
		projectName: string;
		projectDescription: string | null;
		projectImagePath: string | null;
		participantCount: number;
		roleGranted: string;
	};
	projectId: string;
	onComplete: () => void;
}) {
	const t = useTranslations("claim");
	const tPage = useTranslations("projectPage");
	const tProjects = useTranslations("projects");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [registered, setRegistered] = useState(false);
	const [resumeEmailSent, setResumeEmailSent] = useState(false);
	// Two-step identify flow: pick your own name from the project's existing
	// ghosts FIRST, then confirm your email. Only "None of these — I'm new"
	// falls through to a blank name form.
	//   "choose" - "are you one of these people?" chooser (default when ghosts exist)
	//   "form"   - name (pre-filled if a ghost was picked) + email
	const [identifyStep, setIdentifyStep] = useState<"choose" | "form">("form");
	// The ghost the joiner recognised as themselves, if any. When set, the guest
	// session absorbs this ghost's history after registering (via linkGuestToGhost).
	const [selectedGhostId, setSelectedGhostId] = useState<string | null>(null);
	const [unlinkableGhostName, setUnlinkableGhostName] = useState<
		string | null
	>(null);
	// Guards the auto-open effect so a later refetch of the ghost list can't yank
	// the user back to the chooser after they've moved on to the form.
	const [autoOpenedChooser, setAutoOpenedChooser] = useState(false);

	// Unclaimed ghosts in this project, offered so the joiner picks their own
	// name (and links to their existing history) instead of re-typing it. Fetched
	// up front so the chooser can be the FIRST thing shown.
	const { data: projectGhosts, isLoading: ghostsLoading } =
		api.claim.projectGhosts.useQuery({ linkId });

	// Open on the chooser the first time we learn the project has unclaimed ghosts.
	useEffect(() => {
		if (!autoOpenedChooser && projectGhosts && projectGhosts.length > 0) {
			setIdentifyStep("choose");
			setAutoOpenedChooser(true);
		}
	}, [autoOpenedChooser, projectGhosts]);

	const linkGhostMutation = api.claim.linkGuestToGhost.useMutation({
		onSuccess: () => {
			setRegistered(true);
		},
	});

	// NOTE: joining via an invite link never triggers rebalance-on-add. That
	// prompt is organizer-driven (from the Share dialog) — the joiner is the
	// actor, so they must not fold themselves into everyone else's past
	// expenses. See guest.register for the server-side counterpart.
	const registerMutation = api.guest.register.useMutation({
		onSuccess: (data) => {
			if (data.resumeEmailSent) {
				// This email already joined: the server mailed a resume link
				// instead of handing out the existing session.
				setResumeEmailSent(true);
			} else {
				localStorage.setItem("guest_session_token", data.sessionToken);
				localStorage.setItem("guest_project_id", data.projectId);
				if (selectedGhostId) {
					// The joiner recognised themselves as an existing ghost: absorb its
					// history into the new guest session instead of leaving a duplicate.
					linkGhostMutation.mutate({
						linkId,
						guestSessionId: data.guestSessionId,
						shadowId: selectedGhostId,
					});
				} else {
					setRegistered(true);
				}
			}
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !email.trim()) return;
		registerMutation.mutate({
			linkId,
			name: name.trim(),
			email: email.trim(),
		});
	};

	// Picked an existing ghost: carry its name into the form, then just confirm
	// email. Choosing "I'm new" clears any prior pick.
	// A ghost that is also in other projects can't be linked by a guest (the
	// server refuses): join as a new person with that name and explain how to
	// merge the history later.
	const handlePickGhost = (ghost: {
		id: string;
		name: string;
		linkable: boolean;
	}) => {
		setSelectedGhostId(ghost.linkable ? ghost.id : null);
		setUnlinkableGhostName(ghost.linkable ? null : ghost.name);
		setName(ghost.name);
		setIdentifyStep("form");
	};
	const handlePickNew = () => {
		setSelectedGhostId(null);
		setUnlinkableGhostName(null);
		setName("");
		setIdentifyStep("form");
	};

	const handleContinue = () => {
		onComplete();
		// Force page reload so the tRPC client picks up the new guest token
		window.location.href = `/projects/${projectId}`;
	};

	const isJoining =
		registerMutation.isPending || linkGhostMutation.isPending;

	// ── "Are you one of these people?" chooser (shown first) ──
	if (identifyStep === "choose" && projectGhosts && projectGhosts.length > 0) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col gap-4 p-8">
						<div className="text-center">
							<h1 className="font-bold text-xl">{t("chooserTitle")}</h1>
							<p className="mt-1 text-muted-foreground text-sm">
								{t.rich("chooserDescription", {
									projectName: linkInfo.projectName,
									strong: (chunks) => (
										<span className="font-medium text-foreground">{chunks}</span>
									),
								})}
							</p>
						</div>

						<div className="flex flex-col gap-2">
							{projectGhosts.map((ghost) => (
								<Button
									className="justify-start gap-2"
									key={ghost.id}
									onClick={() => handlePickGhost(ghost)}
									variant="outline"
								>
									<Users className="h-4 w-4" />
									{ghost.name}
								</Button>
							))}
						</div>

						<Button
							className="w-full"
							onClick={handlePickNew}
							variant="ghost"
						>
							{t("chooserNoneNew")}
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ── Already joined: resume link sent by email ──
	if (resumeEmailSent) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
							<Mail className="h-8 w-8 text-primary" />
						</div>
						<h1 className="font-bold text-xl">{t("resumeEmailTitle")}</h1>
						<p className="text-muted-foreground text-sm">
							{t.rich("resumeEmailBody", {
								projectName: linkInfo.projectName,
								strong: (chunks) => (
									<span className="font-medium text-foreground">{chunks}</span>
								),
							})}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ── Success state ──
	if (registered) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
							<CheckCircle2 className="h-8 w-8 text-emerald-500" />
						</div>
						<h1 className="font-bold text-xl">{tPage("youreIn")}</h1>
						<p className="text-muted-foreground text-sm">
							{tPage.rich("joinedAs", {
								projectName: linkInfo.projectName,
								role: linkInfo.roleGranted,
								strong: (chunks) => (
									<span className="font-medium text-foreground">{chunks}</span>
								),
							})}
						</p>
						<Button className="mt-2 gap-2" onClick={handleContinue}>
							{tPage("viewProject")}
							<ArrowRight className="h-4 w-4" />
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	// While the ghost list is still loading, hold on the spinner so we can open
	// straight onto the chooser (if there are ghosts) rather than flashing the
	// blank form first.
	if (ghostsLoading && !registered) {
		return <LoadingScreen />;
	}

	// ── Registration form ──
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="p-8">
					{/* Project identity header */}
					<div className="mb-6 flex flex-col items-center gap-3 text-center">
						<ProjectVisual
							imagePath={linkInfo.projectImagePath}
							projectName={linkInfo.projectName}
							size="xl"
						/>
						<div>
							<h1 className="font-bold text-xl">
								{tPage("joinProjectTitle", { projectName: linkInfo.projectName })}
							</h1>
							{linkInfo.projectDescription && (
								<p className="mt-1 text-muted-foreground text-sm">
									{linkInfo.projectDescription}
								</p>
							)}
						</div>
						<div className="flex items-center gap-2 tabular-nums text-muted-foreground text-xs">
							<Users className="h-3.5 w-3.5" />
							<span>
								{tProjects("participantCount", {
									count: linkInfo.participantCount,
								})}
							</span>
							<span className="text-border">|</span>
							<span>
								{tPage.rich("joiningAs", {
									role: roleLabel(tProjects, linkInfo.roleGranted),
									em: (chunks) => (
										<span className="font-medium text-foreground">{chunks}</span>
									),
								})}
							</span>
						</div>
					</div>

					{projectGhosts && projectGhosts.length > 0 && (
						<button
							className="mb-4 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
							onClick={() => setIdentifyStep("choose")}
							type="button"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							{t("chooserBack")}
						</button>
					)}

					{unlinkableGhostName && (
						<p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
							{t.rich("chooserGhostElsewhere", {
								name: unlinkableGhostName,
								strong: (chunks) => (
									<span className="font-medium text-foreground">{chunks}</span>
								),
							})}
						</p>
					)}

					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<label className="font-medium text-sm" htmlFor="join-name">
								{tPage("yourName")}
							</label>
							<Input
								autoFocus
								id="join-name"
								onChange={(e) => setName(e.target.value)}
								placeholder={tPage("enterYourName")}
								required
								value={name}
							/>
						</div>
						<div className="space-y-2">
							<label className="font-medium text-sm" htmlFor="join-email">
								{tPage("emailAddress")}
							</label>
							<Input
								id="join-email"
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@example.com"
								required
								type="email"
								value={email}
							/>
							<p className="text-[11px] text-muted-foreground">
								{tPage("emailHint")}
							</p>
						</div>

						{(registerMutation.isError || linkGhostMutation.isError) && (
							<div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive text-sm">
								{registerMutation.error?.message ??
									linkGhostMutation.error?.message}
							</div>
						)}

						<Button
							className="w-full gap-2"
							disabled={!name.trim() || !email.trim() || isJoining}
							type="submit"
						>
							{isJoining ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									{tPage("joining")}
								</>
							) : (
								<>
									{tPage("joinProject")}
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>

					<p className="mt-4 text-center text-[11px] text-muted-foreground">
						{tPage.rich("haveAccountLogIn", {
							link: (chunks) => (
								<a
									className="text-primary underline underline-offset-2 hover:text-primary/80"
									href="/login"
								>
									{chunks}
								</a>
							),
						})}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Authenticated Project View ───────────────────────────────────────────────

function AuthenticatedProjectView({ id, onFallbackToPublic }: { id: string; onFallbackToPublic: () => void }) {
	const t = useTranslations("projectPage");
	const tProjects = useTranslations("projects");
	const { data: session } = useSession();
	const userId = session?.user?.id;
	const { openNewExpense } = useExpenseModal();

	const utils = api.useUtils();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
	const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
	const [pendingFilterKey, setPendingFilterKey] = useState(0);

	const {
		data: project,
		isLoading,
		isError,
	} = api.project.detail.useQuery({ id });

	// Fallback: if the user is not a participant, try the public view
	const { data: publicProject, isLoading: publicLoading } =
		api.project.publicDetail.useQuery({ id }, { enabled: isError, retry: false });

	useEffect(() => {
		if (isError && publicProject) {
			onFallbackToPublic();
		}
	}, [isError, publicProject, onFallbackToPublic]);

	usePageTitle(project?.name);

	const isOngoing = project?.billingCycleLength != null;
	const isSolo = (project?.participants?.length ?? 0) <= 1;

	const exportExpensesMutation =
		api.exportData.exportProjectExpenses.useMutation();
	const exportSettlementMutation =
		api.exportData.exportSettlementPlan.useMutation();
	const exportPeriodMutation =
		api.exportData.exportBillingPeriodSummary.useMutation();
	const exportPdfMutation =
		api.exportData.exportProjectPdf.useMutation();

	const closePeriodMutation = api.billingPeriod.closeCurrent.useMutation({
		onSuccess: () => {
			toast.success(t("periodClosed"));
			void utils.billingPeriod.list.invalidate({ projectId: id });
			void utils.project.detail.invalidate({ id });
			setCloseConfirmOpen(false);
		},
		onError: (e) => toast.error(e.message),
	});

	const analyticsExclusionMutation = api.project.updateAnalyticsExclusion.useMutation({
		onSuccess: (data) => {
			void utils.project.detail.invalidate({ id });
			void utils.project.list.invalidate();
			void utils.dashboard.invalidate();
			toast.success(
				data.excludeFromAnalytics
					? t("excludedFromAnalytics")
					: t("includedInAnalytics"),
			);
		},
		onError: (e) => toast.error(e.message),
	});

	const handleExportExpenses = async () => {
		if (!project) return;
		try {
			const { csv, filename } = await exportExpensesMutation.mutateAsync({
				projectId: id,
				...(isOngoing && selectedPeriodId
					? { periodId: selectedPeriodId }
					: {}),
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success(t("expensesExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("exportFailed"),
			);
		}
	};

	const handleExportSettlement = async () => {
		if (!project) return;
		try {
			const { csv, filename } = await exportSettlementMutation.mutateAsync({
				projectId: id,
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success(tProjects("settlementPlanExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("exportFailed"),
			);
		}
	};

	const handleExportPeriodSummary = async () => {
		if (!project || !selectedPeriodId) return;
		try {
			const { csv, filename } = await exportPeriodMutation.mutateAsync({
				projectId: id,
				periodId: selectedPeriodId,
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success(t("periodSummaryExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("exportFailed"),
			);
		}
	};

	const handleExportPdf = async () => {
		if (!project) return;
		try {
			const { pdf, filename } = await exportPdfMutation.mutateAsync({
				projectId: id,
				...(isOngoing && selectedPeriodId
					? { periodId: selectedPeriodId }
					: {}),
			});
			downloadPdf(pdf, filename);
			toast.success(t("pdfDownloaded"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("pdfExportFailed"),
			);
		}
	};

	// Fetch billing periods for ONGOING projects
	const { data: periods, isLoading: periodsLoading } =
		api.billingPeriod.list.useQuery({ projectId: id }, { enabled: isOngoing });

	// Auto-select open period when periods load
	useEffect(() => {
		if (periods && periods.length > 0 && !selectedPeriodId) {
			const openPeriod = periods.find((p) => p.status === "OPEN");
			setSelectedPeriodId(openPeriod?.id ?? periods[0]!.id);
		}
	}, [periods, selectedPeriodId]);

	if (isError) {
		// While checking for a public fallback, show loading
		if (publicLoading) {
			return (
				<>
					<SiteHeader title={tProjects("loading")} />
					<PageContent>
						<LoadingScreen />
					</PageContent>
				</>
			);
		}
		// publicProject found → onFallbackToPublic() will fire via useEffect
		if (publicProject) {
			return null;
		}
		// Both detail and publicDetail failed - project is truly inaccessible
		return (
			<>
				<SiteHeader title={t("notFoundTitle")} />
				<PageContent>
					<div className="flex h-64 flex-col items-center justify-center gap-3">
						<p className="text-muted-foreground">
							{t("notFoundDescription")}
						</p>
						<Button asChild variant="outline">
							<Link href="/projects">
								<ArrowLeft className="mr-2 h-4 w-4" />
								{t("backToProjects")}
							</Link>
						</Button>
					</div>
				</PageContent>
			</>
		);
	}

	// Determine user's role
	const myParticipant = project?.participants.find(
		(p) => p.participantType === "user" && p.participantId === userId,
	);
	const isOrganizer = myParticipant?.role === "ORGANIZER";
	const isEditor =
		myParticipant?.role === "EDITOR" || myParticipant?.role === "ORGANIZER";
	const isViewer = myParticipant?.role === "VIEWER";
	const canContribute = !!myParticipant && !isViewer;

	const canClosePeriod =
		isOrganizer || project?.billingClosePermission === "ANY_PARTICIPANT";

	const openPeriod = periods?.find((p) => p.status === "OPEN");
	const showClosePeriod =
		isOngoing && canClosePeriod && !!openPeriod && selectedPeriodId === openPeriod.id;

	const hasBudget =
		project?.budgetAmount !== null &&
		project?.budgetAmount !== undefined &&
		Number(project.budgetAmount) > 0;

	const isAnyExporting =
		exportExpensesMutation.isPending ||
		exportSettlementMutation.isPending ||
		exportPeriodMutation.isPending ||
		exportPdfMutation.isPending;

	const handleAddExpense = canContribute ? () =>
		openNewExpense({
			projectId: id,
			projectName: project?.name,
			isSolo,
			projectDefaultCurrency: project?.primaryCurrency,
		}) : undefined;

	return (
		<>
			<SiteHeader
				title={
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="/projects">{tProjects("title")}</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>
									{isLoading ? (
										<Skeleton className="h-4 w-36" />
									) : (
										(project?.name ?? t("projectFallback"))
									)}
								</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
			/>
			<PageContent fill>
				{isLoading ? (
					<div className="space-y-6">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-[200px]" />
						<Skeleton className="h-[300px] w-full" />
					</div>
				) : project ? (
					<div className="flex flex-col gap-8 flex-1 min-h-0">
						<ProjectHeader
								isExporting={isAnyExporting}
								isEditor={isEditor}
								isOrganizer={isOrganizer}
								onAddExpense={handleAddExpense}
								onExportExpenses={handleExportExpenses}
								onExportSettlement={
									!isSolo ? handleExportSettlement : undefined
								}
								onExportPeriodSummary={
									isOngoing && selectedPeriodId
										? handleExportPeriodSummary
										: undefined
								}
								onExportPdf={handleExportPdf}
					onClosePeriod={showClosePeriod ? () => setCloseConfirmOpen(true) : undefined}
					showClosePeriod={showClosePeriod}
								onSettingsOpen={() => setSettingsOpen(true)}
								participants={project.participants}
								project={{
									id: project.id,
									name: project.name,
									status: project.status,
									description: project.description,
									createdById: project.createdById,
									imagePath: project.imagePath,
								}}
								showPeriodSummaryExport={isOngoing && !!selectedPeriodId}
								primaryCurrency={project.primaryCurrency}
								expenseCount={project.categoryStats.reduce((sum, s) => sum + s.count, 0)}
								currentUserId={userId}
								excludeFromAnalytics={project.excludeFromAnalytics}
								onToggleAnalyticsExclusion={(exclude) =>
									analyticsExclusionMutation.mutate({
										projectId: id,
										exclude,
									})
								}
								isAnalyticsTogglePending={analyticsExclusionMutation.isPending}
							/>

							<ProjectTabs
								categoryStats={project.categoryStats}
								createdById={project.createdById}
								currentUserId={userId}
								isEditor={isEditor}
								isOrganizer={isOrganizer}
								isSolo={isSolo}
								participants={project.participants}
								primaryCurrency={project.primaryCurrency}
								projectId={id}
								projectName={project.name}
								totalSpent={project.totalSpent}
								expensesPanel={
									<>
							{hasBudget && (
								<BudgetCard
									budget={Number(project.budgetAmount)}
									budgetCurrency={
										project.budgetCurrency ?? project.primaryCurrency
									}
									spent={project.totalSpent}
								/>
							)}

							{isOngoing && periods && !periodsLoading && (
								<BillingPeriodTabs
									canClosePeriod={canClosePeriod}
									isLoading={periodsLoading}
									isSolo={isSolo}
									onFilterPending={() => setPendingFilterKey((k) => k + 1)}
									onSelectPeriod={setSelectedPeriodId}
									periods={periods}
									projectId={id}
									selectedPeriodId={selectedPeriodId}
								/>
							)}

							<ExpensesTable
								billingPeriodId={
									isOngoing ? (selectedPeriodId ?? undefined) : undefined
								}
								currentParticipant={{ type: project.myParticipantType, id: project.myParticipantId }}
								pendingFilterTrigger={pendingFilterKey}
								isSolo={isSolo}
								isReadOnly={isViewer}
								autoAcceptSplits={project.autoAcceptSplits}
								onAddExpense={handleAddExpense}
								projectId={id}
							/>
									</>
								}
							/>
					</div>
				) : null}
			</PageContent>


			{project && isEditor && (
				<ProjectSettingsDialog
					onOpenChange={setSettingsOpen}
					open={settingsOpen}
					isOrganizer={isOrganizer}
					project={{
						id: project.id,
						name: project.name,
						description: project.description,
						budgetAmount: project.budgetAmount
							? Number(project.budgetAmount)
							: null,
						budgetCurrency: project.budgetCurrency,
						primaryCurrency: project.primaryCurrency,
						status: project.status,
						billingCycleLength: project.billingCycleLength,
						billingCycleDays: project.billingCycleDays,
						billingAutoClose: project.billingAutoClose,
						billingCloseReminderDays: project.billingCloseReminderDays,
						billingClosePermission: project.billingClosePermission,
						autoAcceptSplits: project.autoAcceptSplits,
						imagePath: project.imagePath,
					}}
				/>
			)}

		<Dialog onOpenChange={setCloseConfirmOpen} open={closeConfirmOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{t("closePeriodTitle", { label: openPeriod?.label ?? "" })}
					</DialogTitle>
					<DialogDescription>{t("closePeriodDescription")}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setCloseConfirmOpen(false)} variant="ghost">
						{tProjects("cancel")}
					</Button>
					<Button
						disabled={closePeriodMutation.isPending}
						onClick={() => closePeriodMutation.mutate({ projectId: id })}
					>
						{closePeriodMutation.isPending ? t("closing") : tProjects("closePeriod")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
		</>
	);
}

// ── Guest Project View ───────────────────────────────────────────────────────

function GuestProjectView({ id }: { id: string }) {
	const t = useTranslations("projectPage");
	const tProjects = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();
	const [addExpenseOpen, setAddExpenseOpen] = useState(false);

	const {
		data: project,
		isLoading: projectLoading,
		isError: projectError,
	} = api.project.detail.useQuery({ id }, { retry: false });

	const { data: expensesData, isLoading: expensesLoading } =
		api.project.listExpenses.useQuery(
			{ projectId: id, page: 1, limit: 500 },
			{ enabled: !!project, retry: false },
		);

	const transactions = (expensesData?.transactions ?? []) as ProjectExpense[];

	const myRole = project?.myRole;
	const canContribute =
		!!myRole && ["CONTRIBUTOR", "EDITOR", "ORGANIZER"].includes(myRole);
	const isSolo = (project?.participants?.length ?? 0) <= 1;

	const currentParticipant =
		project?.myParticipantType && project?.myParticipantId
			? {
					participantType: project.myParticipantType as
						| "user"
						| "guest"
						| "shadow",
					participantId: project.myParticipantId,
				}
			: undefined;

	usePageTitle(project?.name);

	if (projectLoading) {
		return <LoadingScreen />;
	}

	if (projectError || !project) {
		return <SessionExpiredView />;
	}

	const guestExpenseCount = project.categoryStats.reduce((sum, s) => sum + s.count, 0);
	const guestMetaParts: string[] = [];
	if (!isSolo && project.participants.length > 0) {
		guestMetaParts.push(
			tProjects("participantCount", { count: project.participants.length }),
		);
	}
	guestMetaParts.push(project.primaryCurrency);
	guestMetaParts.push(tProjects("expenseCount", { count: guestExpenseCount }));
	const guestMetaSubtitle = guestMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} role={myRole} />

			<main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
				<div className="space-y-1">
					<h2 className="font-bold text-2xl">{project.name}</h2>
					{project.description && (
						<p className="max-w-xl text-muted-foreground text-sm">
							{project.description}
						</p>
					)}
					<p className="text-muted-foreground text-xs">{guestMetaSubtitle}</p>
					{!isSolo && project.participants.length > 0 && (
						<ParticipantRow participants={project.participants} />
					)}
				</div>

				<div className="mb-3 flex items-center justify-between">
					<h3 className="font-semibold text-muted-foreground text-sm tracking-wide">
						{tProjects("tabExpenses")}
					</h3>
					{canContribute && (
						<Button onClick={() => setAddExpenseOpen(true)} size="sm">
							<Plus className="mr-1 h-4 w-4" />
							{tProjects("addExpense")}
						</Button>
					)}
				</div>

				<ReadOnlyExpensesTable
					autoAccept={project?.autoAcceptSplits}
					formatCurrency={formatCurrency}
					isLoading={expensesLoading}
					isSolo={isSolo}
					transactions={transactions}
				/>

				<UpgradeBanner
					canContribute={canContribute}
					participants={project.participants}
					myParticipantType={project.myParticipantType}
					myParticipantId={project.myParticipantId}
				/>
			</main>

			{canContribute && (
				<ExpenseModal
					expenseId=""
					mode="create"
					open={addExpenseOpen}
					onOpenChange={setAddExpenseOpen}
					projectId={id}
					isSolo={isSolo}
					currentParticipant={currentParticipant}
					title={t("addExpenseFor", { projectName: project.name })}
				/>
			)}
		</div>
	);
}

// ── Viewer Project View ──────────────────────────────────────────────────────

function ViewerProjectView({ id }: { id: string }) {
	const tProjects = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();

	const {
		data: project,
		isLoading: projectLoading,
		isError: projectError,
	} = api.project.detail.useQuery({ id }, { retry: false });

	const { data: expensesData, isLoading: expensesLoading } =
		api.project.listExpenses.useQuery(
			{ projectId: id, page: 1, limit: 500 },
			{ enabled: !!project, retry: false },
		);

	const transactions = (expensesData?.transactions ?? []) as ProjectExpense[];
	const isSolo = (project?.participants?.length ?? 0) <= 1;

	usePageTitle(project?.name);

	if (projectLoading) {
		return <LoadingScreen />;
	}

	if (projectError || !project) {
		// Viewer link might be invalid; fall back to public view
		return <PublicProjectView id={id} />;
	}

	const viewerExpenseCount = project.categoryStats.reduce((sum, s) => sum + s.count, 0);
	const viewerMetaParts: string[] = [];
	if (!isSolo && project.participants.length > 0) {
		viewerMetaParts.push(
			tProjects("participantCount", { count: project.participants.length }),
		);
	}
	viewerMetaParts.push(project.primaryCurrency);
	viewerMetaParts.push(tProjects("expenseCount", { count: viewerExpenseCount }));
	const viewerMetaSubtitle = viewerMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} role="VIEWER" />

			<main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
				<div className="space-y-1">
					<h2 className="font-bold text-2xl">{project.name}</h2>
					{project.description && (
						<p className="max-w-xl text-muted-foreground text-sm">
							{project.description}
						</p>
					)}
					<p className="text-muted-foreground text-xs">{viewerMetaSubtitle}</p>
					{!isSolo && project.participants.length > 0 && (
						<ParticipantRow participants={project.participants} />
					)}
				</div>

				<div className="mb-3">
					<h3 className="font-semibold text-muted-foreground text-sm tracking-wide">
						{tProjects("tabExpenses")}
					</h3>
				</div>

				<ReadOnlyExpensesTable
					autoAccept={project?.autoAcceptSplits}
					formatCurrency={formatCurrency}
					isLoading={expensesLoading}
					isSolo={isSolo}
					transactions={transactions}
				/>

				<ReadOnlyBanner />
			</main>
		</div>
	);
}

// ── Public Project View ──────────────────────────────────────────────────────

function PublicProjectView({ id }: { id: string }) {
	const tProjects = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();

	const {
		data: project,
		isLoading: projectLoading,
	} = api.project.publicDetail.useQuery({ id }, { retry: false });

	const { data: expensesData, isLoading: expensesLoading } =
		api.project.publicListExpenses.useQuery(
			{ projectId: id, page: 1, limit: 500 },
			{ enabled: !!project, retry: false },
		);

	const transactions = (expensesData?.transactions ?? []) as ProjectExpense[];
	const isSolo = (project?.participants?.length ?? 0) <= 1;

	usePageTitle(project?.name);

	if (projectLoading) {
		return <LoadingScreen />;
	}

	if (!project) {
		return <PrivateProjectView />;
	}

	const publicExpenseCount = project.categoryStats.reduce((sum, s) => sum + s.count, 0);
	const publicMetaParts: string[] = [];
	if (!isSolo && project.participants.length > 0) {
		publicMetaParts.push(
			tProjects("participantCount", { count: project.participants.length }),
		);
	}
	publicMetaParts.push(project.primaryCurrency);
	publicMetaParts.push(tProjects("expenseCount", { count: publicExpenseCount }));
	const publicMetaSubtitle = publicMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} />

			<main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
				<div className="space-y-1">
					<h2 className="font-bold text-2xl">{project.name}</h2>
					{project.description && (
						<p className="max-w-xl text-muted-foreground text-sm">
							{project.description}
						</p>
					)}
					<p className="text-muted-foreground text-xs">{publicMetaSubtitle}</p>
					{!isSolo && project.participants.length > 0 && (
						<ParticipantRow participants={project.participants} />
					)}
				</div>

				{project.budgetAmount !== null &&
					project.budgetAmount !== undefined &&
					Number(project.budgetAmount) > 0 && (
						<BudgetCard
							budget={Number(project.budgetAmount)}
							budgetCurrency={
								project.budgetCurrency ?? project.primaryCurrency
							}
							spent={project.totalSpent}
						/>
					)}

				<div className="mb-3">
					<h3 className="font-semibold text-muted-foreground text-sm tracking-wide">
						{tProjects("tabExpenses")}
					</h3>
				</div>

				<ReadOnlyExpensesTable
					autoAccept={project?.autoAcceptSplits}
					formatCurrency={formatCurrency}
					isLoading={expensesLoading}
					isSolo={isSolo}
					transactions={transactions}
				/>

				<ReadOnlyBanner />
			</main>
		</div>
	);
}

// ── Private Project View ─────────────────────────────────────────────────────

function PrivateProjectView() {
	const t = useTranslations("projectPage");
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
						<Lock className="h-8 w-8 text-muted-foreground" />
					</div>
					<h1 className="font-bold text-xl">{t("privateTitle")}</h1>
					<p className="text-muted-foreground text-sm">
						{t("privateDescription")}
					</p>
					<Button asChild variant="outline">
						<Link href="/login">
							<LogIn className="mr-2 h-4 w-4" />
							{t("logIn")}
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Session Expired View ─────────────────────────────────────────────────────

function SessionExpiredView() {
	const t = useTranslations("projectPage");
	const router = useRouter();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
						<Link2Off className="h-8 w-8 text-destructive" />
					</div>
					<h1 className="font-bold text-xl">{t("cannotAccessTitle")}</h1>
					<p className="text-muted-foreground text-sm">
						{t("cannotAccessDescription")}
					</p>
					<div className="flex gap-3">
						<Button
							onClick={() => {
								localStorage.removeItem("guest_session_token");
								localStorage.removeItem("guest_project_id");
								localStorage.removeItem("viewer_link_id");
								router.push("/login");
							}}
							variant="outline"
						>
							<LogIn className="mr-2 h-4 w-4" />
							{t("logIn")}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Shared Components ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
	ORGANIZER: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	EDITOR: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	CONTRIBUTOR: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
	VIEWER: "bg-muted/30 text-muted-foreground",
};

const ROLE_LABEL_KEYS = {
	ORGANIZER: "roleOwner",
	EDITOR: "roleEditor",
	CONTRIBUTOR: "roleContributor",
	VIEWER: "roleViewer",
} as const;

function roleLabel(
	tProjects: ReturnType<typeof useTranslations<"projects">>,
	role: string,
): string {
	const key = ROLE_LABEL_KEYS[role as keyof typeof ROLE_LABEL_KEYS];
	return key ? tProjects(key) : role;
}

function MinimalHeader({
	projectName,
	role,
}: {
	projectName: string;
	role?: string | null;
}) {
	const t = useTranslations("projectPage");
	const tProjects = useTranslations("projects");
	return (
		<header className="sticky top-0 z-50 border-border border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
				<h1 className="truncate font-semibold text-sm">{projectName}</h1>
				<div className="flex-1" />
				{role && (
					<Badge
						className={cn("text-[10px]", ROLE_COLORS[role] ?? "")}
						variant="outline"
					>
						{roleLabel(tProjects, role)}
					</Badge>
				)}
				<Button asChild size="sm" variant="outline">
					<Link href="/signup">{t("signUp")}</Link>
				</Button>
			</div>
		</header>
	);
}

function ReadOnlyExpensesTable({
	transactions,
	isLoading,
	formatCurrency,
	isSolo,
	autoAccept,
}: {
	transactions: ProjectExpense[];
	isLoading: boolean;
	formatCurrency: (amount: number, currency: string) => string;
	isSolo?: boolean;
	autoAccept?: boolean;
}) {
	// Bind the same "projects" translator the authenticated table uses so viewer
	// and public read-only tables show real column headers, not the raw keys.
	const t = useTranslations("projects");
	const columns = useMemo(
		() =>
			createProjectExpenseColumns({
				isSolo,
				isReadOnly: true,
				autoAccept,
				formatCurrency,
				t,
			}),
		[isSolo, autoAccept, formatCurrency, t],
	);

	if (isLoading) {
		return (
			<div className="space-y-2">
				{[...Array(4)].map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: skeleton
					<Skeleton className="h-12 w-full" key={i} />
				))}
			</div>
		);
	}

	if (transactions.length === 0) {
		return (
			<div className="rounded-xl border border-border border-dashed py-12 text-center text-muted-foreground text-sm">
				{t("noExpensesAdded")}
			</div>
		);
	}

	return (
		<DataTable
			columns={columns}
			countNoun={t("expensesNoun")}
			data={transactions}
			initialSorting={[{ id: "date", desc: true }]}
			pagination={{ defaultPageSize: 20 }}
			searchPlaceholder={t("searchExpenses")}
			totalCount={transactions.length}
		/>
	);
}

function UpgradeBanner({
	canContribute,
	participants,
	myParticipantType,
	myParticipantId,
}: {
	canContribute: boolean;
	participants: Array<{
		participantType: string;
		participantId: string;
		email?: string | null;
		name: string;
	}>;
	myParticipantType: string;
	myParticipantId: string;
}) {
	const t = useTranslations("projectPage");
	const me = participants.find(
		(p) =>
			p.participantType === myParticipantType &&
			p.participantId === myParticipantId,
	);
	const signupParams = new URLSearchParams({ upgrade: "true" });
	if (me?.email) signupParams.set("email", me.email);
	if (me?.name) signupParams.set("name", me.name);

	return (
		<Card className="border-primary/20 bg-primary/5">
			<CardContent className="flex flex-col items-center gap-3 p-5 text-center">
				<h3 className="font-semibold text-sm">
					{canContribute ? t("keepContributionsSafe") : t("getFullAccess")}
				</h3>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{t("guestAccessLimited")}
				</p>
				<Button asChild size="sm">
					<a href={`/signup?${signupParams.toString()}`}>
						{t("createFreeAccount")}
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}

function ReadOnlyBanner() {
	const t = useTranslations("projectPage");
	return (
		<Card className="border-muted bg-muted/30">
			<CardContent className="flex flex-col items-center gap-2 p-4 text-center">
				<p className="text-muted-foreground text-sm">
					{t.rich("readOnlyNotice", {
						link: (chunks) => (
							<a
								href="/signup"
								className="text-primary underline underline-offset-2 hover:text-primary/80"
							>
								{chunks}
							</a>
						),
					})}
				</p>
			</CardContent>
		</Card>
	);
}
