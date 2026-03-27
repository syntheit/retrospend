"use client";

import { format } from "date-fns";
import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Link2,
	Link2Off,
	Loader2,
	Lock,
	LogIn,
	Plus,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { usePageTitle } from "~/hooks/use-page-title";
import { ActivityFeedPanel } from "~/components/project/activity-feed-panel";
import { BillingPeriodTabs } from "~/components/project/billing-period-tabs";
import { BudgetCard } from "~/components/project/budget-card";
import { ExpensesTable } from "~/components/project/expenses-table";
import { ParticipantRow, ProjectHeader } from "~/components/project/project-header";
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

	const [accessMode, setAccessMode] = useState<AccessMode>("resolving");
	const [inviteHandled, setInviteHandled] = useState(!inviteLinkId);
	const [inviteErrorMessage, setInviteErrorMessage] = useState<string | null>(null);

	// Session check
	const { data: session, isPending: sessionPending } = useSession();

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
			setInviteErrorMessage("This invite link is for a different project.");
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

		// Non-VIEWER: check if user is already authenticated
		if (session?.user) {
			// Logged-in user: strip param and continue as authenticated
			stripInviteParam();
			setInviteHandled(true);
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
	}, [inviteLinkId, inviteHandled, linkLoading, linkError, linkInfo, session, id]);

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
	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="flex flex-col items-center gap-3">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				<p className="text-muted-foreground text-sm">Loading project...</p>
			</div>
		</div>
	);
}

// ── Invite Error ─────────────────────────────────────────────────────────────

function InviteErrorView({ message }: { message?: string }) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
						<Link2 className="h-8 w-8 text-destructive" />
					</div>
					<h1 className="font-bold text-xl">Invalid Invite Link</h1>
					<p className="text-muted-foreground text-sm">
						{message ?? "This invite link is invalid or has expired. Ask the project organizer for a new invite link."}
					</p>
					<Button asChild variant="outline">
						<Link href="/login">
							<LogIn className="mr-2 h-4 w-4" />
							Log In
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
		projectType: string;
		projectImagePath: string | null;
		participantCount: number;
		roleGranted: string;
	};
	projectId: string;
	onComplete: () => void;
}) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [registered, setRegistered] = useState(false);
	const [isExistingUser, setIsExistingUser] = useState(false);

	const registerMutation = api.guest.register.useMutation({
		onSuccess: (data) => {
			if (data.existingUser) {
				setIsExistingUser(true);
				setRegistered(true);
			} else {
				localStorage.setItem("guest_session_token", data.sessionToken);
				localStorage.setItem("guest_project_id", data.projectId);
				setRegistered(true);
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

	const handleContinue = () => {
		if (isExistingUser) {
			router.push("/login");
		} else {
			onComplete();
			// Force page reload so the tRPC client picks up the new guest token
			window.location.href = `/projects/${projectId}`;
		}
	};

	// ── Success state ──
	if (registered) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
							<CheckCircle2 className="h-8 w-8 text-emerald-500" />
						</div>
						{isExistingUser ? (
							<>
								<h1 className="font-bold text-xl">
									You&apos;re Already a Member!
								</h1>
								<p className="text-muted-foreground text-sm">
									Your account has been added to{" "}
									<span className="font-medium text-foreground">
										{linkInfo.projectName}
									</span>
									. Log in to view the project.
								</p>
								<Button className="mt-2 gap-2" onClick={handleContinue}>
									Go to Login
									<ArrowRight className="h-4 w-4" />
								</Button>
							</>
						) : (
							<>
								<h1 className="font-bold text-xl">You&apos;re In!</h1>
								<p className="text-muted-foreground text-sm">
									You&apos;ve joined{" "}
									<span className="font-medium text-foreground">
										{linkInfo.projectName}
									</span>{" "}
									as a{" "}
									<span className="capitalize">
										{linkInfo.roleGranted.toLowerCase()}
									</span>
									.
								</p>
								<Button className="mt-2 gap-2" onClick={handleContinue}>
									View Project
									<ArrowRight className="h-4 w-4" />
								</Button>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		);
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
							projectType={linkInfo.projectType}
							size="xl"
						/>
						<div>
							<h1 className="font-bold text-xl">
								Join {linkInfo.projectName}
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
								{linkInfo.participantCount} participant
								{linkInfo.participantCount !== 1 ? "s" : ""}
							</span>
							<span className="text-border">|</span>
							<span>
								Joining as{" "}
								<span className="font-medium capitalize text-foreground">
									{linkInfo.roleGranted.toLowerCase()}
								</span>
							</span>
						</div>
					</div>

					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<label className="font-medium text-sm" htmlFor="join-name">
								Your name
							</label>
							<Input
								autoFocus
								id="join-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="Enter your name"
								required
								value={name}
							/>
						</div>
						<div className="space-y-2">
							<label className="font-medium text-sm" htmlFor="join-email">
								Email address
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
								Used to identify you in the project. Not shared publicly.
							</p>
						</div>

						{registerMutation.isError && (
							<div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive text-sm">
								{registerMutation.error.message}
							</div>
						)}

						<Button
							className="w-full gap-2"
							disabled={
								!name.trim() ||
								!email.trim() ||
								registerMutation.isPending
							}
							type="submit"
						>
							{registerMutation.isPending ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									Joining...
								</>
							) : (
								<>
									Join Project
									<ArrowRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</form>

					<p className="mt-4 text-center text-[11px] text-muted-foreground">
						Already have an account?{" "}
						<a
							className="text-primary underline underline-offset-2 hover:text-primary/80"
							href="/login"
						>
							Log in instead
						</a>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Authenticated Project View ───────────────────────────────────────────────

function AuthenticatedProjectView({ id, onFallbackToPublic }: { id: string; onFallbackToPublic: () => void }) {
	const { data: session } = useSession();
	const userId = session?.user?.id;
	const { openNewExpense } = useExpenseModal();

	const utils = api.useUtils();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [activityOpen, setActivityOpen] = useState(false);
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

	const isOngoing = project?.type === "ONGOING";
	const isSolo = project?.type === "SOLO";

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
			toast.success("Period closed: participants will be asked to verify expenses");
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
					? "Project excluded from analytics"
					: "Project included in analytics",
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
			toast.success("Expenses exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export",
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
			toast.success("Settlement plan exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export",
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
			toast.success("Period summary exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export",
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
			toast.success("PDF summary downloaded");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export PDF",
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
					<SiteHeader title="Loading..." />
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
				<SiteHeader title="Project not found" />
				<PageContent>
					<div className="flex h-64 flex-col items-center justify-center gap-3">
						<p className="text-muted-foreground">
							This project could not be found.
						</p>
						<Button asChild variant="outline">
							<Link href="/projects">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to Projects
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
								<BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>
									{isLoading ? (
										<Skeleton className="h-4 w-36" />
									) : (
										(project?.name ?? "Project")
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
								isSolo={isSolo}
								onActivityOpen={() => setActivityOpen(true)}
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
									type: project.type,
									status: project.status,
									description: project.description,
									createdById: project.createdById,
									imagePath: project.imagePath,
								}}
								showPeriodSummaryExport={isOngoing && !!selectedPeriodId}
								unseenCount={project.unseenChangesCount}
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
								onAddExpense={handleAddExpense}
								projectId={id}
							/>
					</div>
				) : null}
			</PageContent>

			{project && (
				<ActivityFeedPanel
					onClose={() => setActivityOpen(false)}
					projectId={activityOpen ? id : null}
					projectName={project.name}
				/>
			)}

			{project && isEditor && (
				<ProjectSettingsDialog
					onOpenChange={setSettingsOpen}
					open={settingsOpen}
					isOrganizer={isOrganizer}
					project={{
						id: project.id,
						name: project.name,
						type: project.type,
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
						imagePath: project.imagePath,
					}}
				/>
			)}

		<Dialog onOpenChange={setCloseConfirmOpen} open={closeConfirmOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Close {openPeriod?.label}?</DialogTitle>
					<DialogDescription>
						All participants will be asked to verify expenses for this period.
						New expenses will go into the next period.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setCloseConfirmOpen(false)} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={closePeriodMutation.isPending}
						onClick={() => closePeriodMutation.mutate({ projectId: id })}
					>
						{closePeriodMutation.isPending ? "Closing..." : "Close Period"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
		</>
	);
}

// ── Guest Project View ───────────────────────────────────────────────────────

function GuestProjectView({ id }: { id: string }) {
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
	const isSolo = project?.type === "SOLO";

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
		guestMetaParts.push(`${project.participants.length} participant${project.participants.length !== 1 ? "s" : ""}`);
	}
	guestMetaParts.push(project.primaryCurrency);
	guestMetaParts.push(`${guestExpenseCount} expense${guestExpenseCount !== 1 ? "s" : ""}`);
	const guestMetaSubtitle = guestMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} projectType={project.type} role={myRole} />

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
						Expenses
					</h3>
					{canContribute && (
						<Button onClick={() => setAddExpenseOpen(true)} size="sm">
							<Plus className="mr-1 h-4 w-4" />
							Add Expense
						</Button>
					)}
				</div>

				<ReadOnlyExpensesTable
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
					title={`Add Expense for ${project.name}`}
				/>
			)}
		</div>
	);
}

// ── Viewer Project View ──────────────────────────────────────────────────────

function ViewerProjectView({ id }: { id: string }) {
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
	const isSolo = project?.type === "SOLO";

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
		viewerMetaParts.push(`${project.participants.length} participant${project.participants.length !== 1 ? "s" : ""}`);
	}
	viewerMetaParts.push(project.primaryCurrency);
	viewerMetaParts.push(`${viewerExpenseCount} expense${viewerExpenseCount !== 1 ? "s" : ""}`);
	const viewerMetaSubtitle = viewerMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} projectType={project.type} role="VIEWER" />

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
						Expenses
					</h3>
				</div>

				<ReadOnlyExpensesTable
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
	const isSolo = project?.type === "SOLO";

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
		publicMetaParts.push(`${project.participants.length} participant${project.participants.length !== 1 ? "s" : ""}`);
	}
	publicMetaParts.push(project.primaryCurrency);
	publicMetaParts.push(`${publicExpenseCount} expense${publicExpenseCount !== 1 ? "s" : ""}`);
	const publicMetaSubtitle = publicMetaParts.join(" · ");

	return (
		<div className="min-h-screen bg-background">
			<MinimalHeader projectName={project.name} projectType={project.type} />

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
						Expenses
					</h3>
				</div>

				<ReadOnlyExpensesTable
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
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
						<Lock className="h-8 w-8 text-muted-foreground" />
					</div>
					<h1 className="font-bold text-xl">This project is private</h1>
					<p className="text-muted-foreground text-sm">
						You don&apos;t have access to this project. If you have an invite
						link, ask the project owner to share it with you.
					</p>
					<Button asChild variant="outline">
						<Link href="/login">
							<LogIn className="mr-2 h-4 w-4" />
							Log In
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Session Expired View ─────────────────────────────────────────────────────

function SessionExpiredView() {
	const router = useRouter();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
					<div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
						<Link2Off className="h-8 w-8 text-destructive" />
					</div>
					<h1 className="font-bold text-xl">Cannot Access Project</h1>
					<p className="text-muted-foreground text-sm">
						Your guest session may have expired. Try using the invite link
						again, or log in if you have an account.
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
							Log In
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

// ── Shared Components ────────────────────────────────────────────────────────

const PROJECT_TYPE_LABELS: Record<string, string> = {
	TRIP: "Trip",
	ONGOING: "Ongoing",
	SOLO: "Solo",
	ONE_TIME: "One-Time",
	GENERAL: "General",
};

const PROJECT_TYPE_COLORS: Record<string, string> = {
	TRIP: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	ONGOING: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	SOLO: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	ONE_TIME: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
	GENERAL: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

const ROLE_COLORS: Record<string, string> = {
	ORGANIZER: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	EDITOR: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	CONTRIBUTOR: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
	VIEWER: "bg-muted/30 text-muted-foreground",
};

const ROLE_LABELS: Record<string, string> = {
	ORGANIZER: "Organizer",
	EDITOR: "Editor",
	CONTRIBUTOR: "Contributor",
	VIEWER: "Viewer",
};

function MinimalHeader({
	projectName,
	projectType,
	role,
}: {
	projectName: string;
	projectType: string;
	role?: string | null;
}) {
	return (
		<header className="sticky top-0 z-50 border-border border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
				<h1 className="truncate font-semibold text-sm">{projectName}</h1>
				<Badge
					className={`shrink-0 text-[10px] ${PROJECT_TYPE_COLORS[projectType] ?? ""}`}
					variant="outline"
				>
					{PROJECT_TYPE_LABELS[projectType] ?? projectType}
				</Badge>
				<div className="flex-1" />
				{role && (
					<Badge
						className={cn("text-[10px]", ROLE_COLORS[role] ?? "")}
						variant="outline"
					>
						{ROLE_LABELS[role] ?? role}
					</Badge>
				)}
				<Button asChild size="sm" variant="outline">
					<Link href="/signup">Sign up</Link>
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
}: {
	transactions: ProjectExpense[];
	isLoading: boolean;
	formatCurrency: (amount: number, currency: string) => string;
	isSolo?: boolean;
}) {
	const columns = useMemo(
		() =>
			createProjectExpenseColumns({
				isSolo,
				isReadOnly: true,
				formatCurrency,
			}),
		[isSolo, formatCurrency],
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
				No expenses yet.
			</div>
		);
	}

	return (
		<DataTable
			columns={columns}
			countNoun="expenses"
			data={transactions}
			initialSorting={[{ id: "date", desc: true }]}
			pagination={{ defaultPageSize: 20 }}
			searchPlaceholder="Search expenses..."
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
					{canContribute
						? "Keep your contributions safe"
						: "Get full access to your finances"}
				</h3>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Guest access is limited to this browser. Create a free account to
					access your data anywhere, track budgets, import bank statements,
					and more.
				</p>
				<Button asChild size="sm">
					<a href={`/signup?${signupParams.toString()}`}>
						Create Free Account
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}

function ReadOnlyBanner() {
	return (
		<Card className="border-muted bg-muted/30">
			<CardContent className="flex flex-col items-center gap-2 p-4 text-center">
				<p className="text-muted-foreground text-sm">
					This is a read-only view.{" "}
					<a
						href="/signup"
						className="text-primary underline underline-offset-2 hover:text-primary/80"
					>
						Sign up
					</a>{" "}
					to track your own expenses.
				</p>
			</CardContent>
		</Card>
	);
}
