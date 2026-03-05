"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { RateSyncControl } from "~/components/rate-sync-control";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useSession } from "~/hooks/use-session";
import { DEFAULT_PAGE_SIZE } from "~/lib/constants";
import { api } from "~/trpc/react";
import { ActionDialog } from "./action-dialog";
import { AdminOverviewStats } from "./admin-overview-stats";
import { AiUsageTable } from "./ai-usage-table";
import { AuditLogsTable } from "./audit-logs-table";
import { BackupStatusCard } from "./backup-status-card";
import { InviteCodesTable } from "./invite-codes-table";
import { UsersTable } from "./users-table";

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	role: string;
	username: string;
	isActive: boolean;
};

type PendingAction =
	| { type: "resetPassword"; userId: string; username: string }
	| {
			type: "toggleUserStatus";
			userId: string;
			username: string;
			isActive: boolean;
	  }
	| { type: "deleteUser"; userId: string; username: string }
	| { type: "deleteInviteCode"; inviteCodeId: string; code: string }
	| {
			type: "toggleEmailVerification";
			userId: string;
			username: string;
			verified: boolean;
	  }
	| null;

export function AdminPanel() {
	const tabsRef = useRef<HTMLDivElement>(null);
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [resetResult, setResetResult] = useState<{
		newPassword: string;
	} | null>(null);

	// Pagination and filtering state for invite codes
	const [inviteCodesStatus, setInviteCodesStatus] = useState<"active" | "used">(
		"active",
	);
	const [inviteCodesPage, setInviteCodesPage] = useState(1);
	const inviteCodesPageSize = DEFAULT_PAGE_SIZE;

	const { data: session } = useSession();
	const extendedUser = session?.user as ExtendedUser;
	const isAdmin = extendedUser?.role === "ADMIN";

	const {
		data: users,
		isLoading,
		refetch,
	} = api.admin.listUsers.useQuery(undefined, {
		enabled: isAdmin,
	});

	const {
		data: inviteCodesData,
		isLoading: inviteCodesLoading,
		refetch: refetchInviteCodes,
	} = api.invite.list.useQuery(
		{
			status: inviteCodesStatus,
			page: inviteCodesPage,
			pageSize: inviteCodesPageSize,
		},
		{
			enabled: isAdmin,
		},
	);

	const { data: settings, refetch: refetchSettings } =
		api.admin.getSettings.useQuery(undefined, {
			enabled: isAdmin,
		});

	const { data: aiSettings, refetch: refetchAiSettings } =
		api.admin.getAiSettings.useQuery(undefined, {
			enabled: isAdmin,
		});

	const resetPasswordMutation = api.admin.resetPassword.useMutation();
	const disableUserMutation = api.admin.disableUser.useMutation();
	const enableUserMutation = api.admin.enableUser.useMutation();
	const deleteUserMutation = api.admin.deleteUser.useMutation();
	const toggleEmailVerificationMutation =
		api.admin.toggleEmailVerification.useMutation();
	const deleteInviteCodeMutation = api.invite.delete.useMutation();
	const updateSettingsMutation = api.admin.updateSettings.useMutation();
	const updateAiSettingsMutation = api.admin.updateAiSettings.useMutation();
	const setUserAiAccessMutation = api.admin.setUserAiAccess.useMutation();

	const handleAction = (action: PendingAction) => {
		setPendingAction(action);
		setDialogOpen(true);
	};

	const handleConfirmAction = async () => {
		if (!pendingAction) return;

		try {
			switch (pendingAction.type) {
				case "resetPassword": {
					const passwordResetResult = await resetPasswordMutation.mutateAsync({
						userId: pendingAction.userId,
					});
					setResetResult({ newPassword: passwordResetResult.newPassword });
					// Keep dialog open to show the new password
					return;
				}

				case "toggleUserStatus":
					if (pendingAction.isActive) {
						await disableUserMutation.mutateAsync({
							userId: pendingAction.userId,
						});
						toast.success(`User @${pendingAction.username} has been disabled`);
					} else {
						await enableUserMutation.mutateAsync({
							userId: pendingAction.userId,
						});
						toast.success(`User @${pendingAction.username} has been enabled`);
					}
					break;

				case "deleteUser":
					await deleteUserMutation.mutateAsync({
						userId: pendingAction.userId,
					});
					toast.success(`User @${pendingAction.username} has been deleted`);
					break;

				case "deleteInviteCode":
					await deleteInviteCodeMutation.mutateAsync({
						id: pendingAction.inviteCodeId,
					});
					toast.success(`Invite code ${pendingAction.code} has been deleted`);
					await refetchInviteCodes();
					break;

				case "toggleEmailVerification":
					await toggleEmailVerificationMutation.mutateAsync({
						userId: pendingAction.userId,
						verified: pendingAction.verified,
					});
					toast.success(
						`Email for @${pendingAction.username} marked as ${
							pendingAction.verified ? "verified" : "unverified"
						}`,
					);
					break;
			}

			await refetch();
			setDialogOpen(false);
			setPendingAction(null);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "An error occurred";
			toast.error(message);
		}
	};

	const handleCancelAction = () => {
		setDialogOpen(false);
		setPendingAction(null);
		setResetResult(null);
	};

	const handleDialogOpenChange = (open: boolean) => {
		setDialogOpen(open);
		if (!open) {
			setPendingAction(null);
			setResetResult(null);
		}
	};

	const handleToggleInviteOnly = async (enabled: boolean) => {
		try {
			await updateSettingsMutation.mutateAsync({
				inviteOnlyEnabled: enabled,
				allowAllUsersToGenerateInvites:
					settings?.allowAllUsersToGenerateInvites ?? false,
				enableEmail: settings?.enableEmail ?? true,
			});
			toast.success(`Invite-only signups ${enabled ? "enabled" : "disabled"}`);
			refetchSettings();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to update settings";
			toast.error(message);
		}
	};

	const handleToggleUserInvites = async (enabled: boolean) => {
		try {
			await updateSettingsMutation.mutateAsync({
				inviteOnlyEnabled: settings?.inviteOnlyEnabled ?? false,
				allowAllUsersToGenerateInvites: enabled,
				enableEmail: settings?.enableEmail ?? true,
			});
			toast.success(
				`User invite code generation ${enabled ? "enabled" : "disabled"}`,
			);
			refetchSettings();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to update settings";
			toast.error(message);
		}
	};

	const handleInviteCodesStatusChange = (newStatus: "active" | "used") => {
		setInviteCodesStatus(newStatus);
		setInviteCodesPage(1);
	};

	const getDialogContent = () => {
		if (!pendingAction) return null;

		switch (pendingAction.type) {
			case "resetPassword":
				return {
					title: "Reset Password",
					description: `Are you sure you want to reset the password for @${pendingAction.username}? A new random password will be generated.`,
					confirmLabel: "Reset Password",
					variant: "default" as const,
				};

			case "toggleUserStatus":
				return {
					title: pendingAction.isActive ? "Disable User" : "Enable User",
					description: pendingAction.isActive
						? `Are you sure you want to disable @${pendingAction.username}? They will no longer be able to sign in.`
						: `Are you sure you want to enable @${pendingAction.username}? They will be able to sign in again.`,
					confirmLabel: pendingAction.isActive ? "Disable User" : "Enable User",
					variant: "default" as const,
				};

			case "deleteUser":
				return {
					title: "Delete User",
					description: `Are you sure you want to delete @${pendingAction.username}? This action cannot be undone and will permanently remove all their data.`,
					confirmLabel: "Delete User",
					variant: "destructive" as const,
				};

			case "deleteInviteCode":
				return {
					title: "Delete Invite Code",
					description: `Are you sure you want to delete the invite code "${pendingAction.code}"? This action cannot be undone.`,
					confirmLabel: "Delete Code",
					variant: "destructive" as const,
				};

			case "toggleEmailVerification":
				return {
					title: pendingAction.verified
						? "Mark Email as Verified"
						: "Mark Email as Unverified",
					description: pendingAction.verified
						? `Are you sure you want to manually mark the email for @${pendingAction.username} as verified?`
						: `Are you sure you want to mark the email for @${pendingAction.username} as unverified? They will need to verify it again.`,
					confirmLabel: pendingAction.verified
						? "Mark as Verified"
						: "Mark as Unverified",
					variant: "default" as const,
				};
		}
	};

	const dialogContent = getDialogContent();
	const isLoadingAction =
		resetPasswordMutation.isPending ||
		disableUserMutation.isPending ||
		enableUserMutation.isPending ||
		deleteUserMutation.isPending ||
		toggleEmailVerificationMutation.isPending ||
		deleteInviteCodeMutation.isPending;

	if (!isAdmin) {
		return null;
	}

	return (
		<>
			<SiteHeader title="Admin Panel" />
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-8">
					{/* Health Overview */}
					<AdminOverviewStats />

					<Separator />

					{/* Settings Section */}
					<div className="space-y-4">
						<div>
							<h2 className="font-semibold text-lg tracking-tight">Settings</h2>
							<p className="text-muted-foreground text-sm">
								Registration and email configuration.
							</p>
						</div>
						<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
							<Card className="flex h-full flex-col">
								<CardHeader>
									<CardTitle>Registration Settings</CardTitle>
									<CardDescription>
										Control how new users can sign up for the application.
									</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-grow flex-col gap-6">
									<div className="flex items-center justify-between space-x-2">
										<div className="space-y-0.5">
											<label
												className="font-medium text-sm"
												htmlFor="invite-codes-switch"
											>
												Require Invite Codes
											</label>
											<p className="text-muted-foreground text-xs">
												When enabled, new users must provide a valid invite code
												to sign up.
											</p>
										</div>
										<Switch
											checked={settings?.inviteOnlyEnabled ?? false}
											disabled={updateSettingsMutation.isPending}
											id="invite-codes-switch"
											onCheckedChange={handleToggleInviteOnly}
										/>
									</div>
									<div
										className={`flex items-center justify-between space-x-2 ${!(settings?.inviteOnlyEnabled ?? false) ? "opacity-50" : ""}`}
									>
										<div className="space-y-0.5">
											<label
												className={`font-medium text-sm ${!(settings?.inviteOnlyEnabled ?? false) ? "text-muted-foreground" : ""}`}
												htmlFor="user-invite-codes-switch"
											>
												Allow User Invites
											</label>
											<p className="text-muted-foreground text-xs">
												When enabled, users can manage their own invite codes.
											</p>
										</div>
										<Switch
											checked={
												settings?.allowAllUsersToGenerateInvites ?? false
											}
											disabled={
												updateSettingsMutation.isPending ||
												!(settings?.inviteOnlyEnabled ?? false)
											}
											id="user-invite-codes-switch"
											onCheckedChange={handleToggleUserInvites}
										/>
									</div>
								</CardContent>
							</Card>

							<EmailServerCard
								adminEmail={extendedUser?.email}
								onSettingsChange={refetchSettings}
								settings={settings}
							/>

							<AiSettingsCard
								aiSettings={aiSettings}
								isUpdating={updateAiSettingsMutation.isPending}
								onUpdate={async (updates) => {
									try {
										await updateAiSettingsMutation.mutateAsync(updates);
										toast.success("AI settings updated");
										refetchAiSettings();
									} catch (error) {
										toast.error(
											error instanceof Error
												? error.message
												: "Failed to update AI settings",
										);
									}
								}}
							/>
						</div>
					</div>

					{/* Services Section */}
					<div className="space-y-4">
						<div>
							<h2 className="font-semibold text-lg tracking-tight">Services</h2>
							<p className="text-muted-foreground text-sm">
								Exchange rates and database backup management.
							</p>
						</div>
						<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
							<RateSyncControl />
							<BackupStatusCard />
						</div>
					</div>

					<Separator />

					{/* Data Management Tabs */}
					<Tabs
						defaultValue="users"
						onValueChange={() => {
							requestAnimationFrame(() => {
								tabsRef.current?.scrollIntoView({
									behavior: "smooth",
									block: "start",
								});
							});
						}}
						ref={tabsRef}
					>
						<TabsList>
							<TabsTrigger value="users">Users</TabsTrigger>
							<TabsTrigger value="invite-codes">Invite Codes</TabsTrigger>
							<TabsTrigger value="ai-usage">AI Usage</TabsTrigger>
							<TabsTrigger value="audit-logs">Audit Logs</TabsTrigger>
						</TabsList>

						<TabsContent value="users">
							<UsersTable
								currentUserId={session?.user?.id}
								isLoading={isLoading}
								onDeleteUser={(userId, username) =>
									handleAction({ type: "deleteUser", userId, username })
								}
								onMarkEmailVerified={(userId, username, verified) =>
									handleAction({
										type: "toggleEmailVerification",
										userId,
										username,
										verified,
									})
								}
								onResetPassword={(userId, username) =>
									handleAction({ type: "resetPassword", userId, username })
								}
								onToggleUserStatus={(userId, username, isActive) =>
									handleAction({
										type: "toggleUserStatus",
										userId,
										username,
										isActive,
									})
								}
								onSetAiAccess={async (userId, allowed) => {
									try {
										await setUserAiAccessMutation.mutateAsync({
											userId,
											externalAiAllowed: allowed,
										});
										toast.success("AI access updated");
										await refetch();
									} catch (error) {
										toast.error(
											error instanceof Error
												? error.message
												: "Failed to update AI access",
										);
									}
								}}
								users={users || []}
							/>
						</TabsContent>

						<TabsContent value="invite-codes">
							<InviteCodesTable
								inviteCodes={inviteCodesData?.items || []}
								isLoading={inviteCodesLoading}
								onDeleteCode={(inviteCodeId, code) =>
									handleAction({ type: "deleteInviteCode", inviteCodeId, code })
								}
								onGenerateCode={refetchInviteCodes}
								onPageChange={setInviteCodesPage}
								onStatusChange={handleInviteCodesStatusChange}
								pagination={inviteCodesData?.pagination}
								status={inviteCodesStatus}
							/>
						</TabsContent>

						<TabsContent value="ai-usage">
							<AiUsageTable />
						</TabsContent>

						<TabsContent value="audit-logs">
							<AuditLogsTable />
						</TabsContent>
					</Tabs>
				</div>
			</PageContent>

			{dialogContent && (
				<ActionDialog
					confirmLabel={dialogContent.confirmLabel}
					description={dialogContent.description}
					isLoading={isLoadingAction}
					onCancel={handleCancelAction}
					onConfirm={handleConfirmAction}
					onOpenChange={handleDialogOpenChange}
					open={dialogOpen}
					resetResult={resetResult || undefined}
					title={dialogContent.title}
					variant={dialogContent.variant}
				/>
			)}
		</>
	);
}

function EmailServerCard({
	adminEmail,
	settings,
	onSettingsChange,
}: {
	adminEmail?: string | null;
	settings?: {
		inviteOnlyEnabled: boolean;
		allowAllUsersToGenerateInvites: boolean;
		enableEmail: boolean;
	} | null;
	onSettingsChange: () => void;
}) {
	const [testEmail, setTestEmail] = useState(adminEmail ?? "");
	const [testEmailType, setTestEmailType] = useState<
		"basic" | "password-reset" | "credential-change" | "email-verification"
	>("basic");
	const utils = api.useUtils();
	const { data: appFeatures, isLoading } = api.auth.getAppFeatures.useQuery();
	const updateSettingsMutation = api.admin.updateSettings.useMutation();
	const sendTestEmailMutation = api.admin.sendTestEmail.useMutation({
		onSuccess: (data) => {
			toast.success(data.message);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleSendTestEmail = (e: React.FormEvent) => {
		e.preventDefault();
		if (!testEmail) {
			toast.error("Please enter an email address");
			return;
		}
		sendTestEmailMutation.mutate({ email: testEmail, type: testEmailType });
	};

	return (
		<Card className="flex h-full flex-col">
			<CardHeader>
				<CardTitle>Email Server (SMTP)</CardTitle>
				<CardDescription>
					Network configuration for sending system emails.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-grow flex-col space-y-4">
				<div className="flex items-center gap-2">
					<div
						className={`h-2.5 w-2.5 rounded-full ${
							isLoading
								? "bg-muted"
								: appFeatures?.isSmtpConfigured
									? "bg-green-500"
									: "bg-destructive"
						}`}
					/>
					<span className="font-medium text-sm">
						Status:{" "}
						{isLoading
							? "Checking..."
							: appFeatures?.isSmtpConfigured
								? "Configured in Environment"
								: "Not Configured (Check .env)"}
					</span>
				</div>

				<div
					className={`flex items-center justify-between space-x-2 ${!appFeatures?.isSmtpConfigured ? "opacity-50" : ""}`}
				>
					<div className="space-y-0.5">
						<label
							className={`font-medium text-sm ${!appFeatures?.isSmtpConfigured ? "text-muted-foreground" : ""}`}
							htmlFor="enable-email-switch"
						>
							Enable Email Functionality
						</label>
						<p className="text-muted-foreground text-xs">
							When enabled, the system will send emails for verification,
							password resets, and notifications.
						</p>
					</div>
					<Switch
						checked={settings?.enableEmail ?? true}
						disabled={
							updateSettingsMutation.isPending || !appFeatures?.isSmtpConfigured
						}
						id="enable-email-switch"
						onCheckedChange={async (enabled) => {
							try {
								await updateSettingsMutation.mutateAsync({
									inviteOnlyEnabled: settings?.inviteOnlyEnabled ?? false,
									allowAllUsersToGenerateInvites:
										settings?.allowAllUsersToGenerateInvites ?? false,
									enableEmail: enabled,
								});
								toast.success(
									`Email functionality ${enabled ? "enabled" : "disabled"}`,
								);
								onSettingsChange();
								void utils.auth.getAppFeatures.invalidate();
							} catch (error) {
								toast.error(
									error instanceof Error
										? error.message
										: "Failed to update settings",
								);
							}
						}}
					/>
				</div>

				<div className="flex-grow" />

				{appFeatures?.isEmailEnabled && (
					<form className="space-y-4 pt-2" onSubmit={handleSendTestEmail}>
						<div className="flex flex-col gap-3">
							<div className="flex gap-2">
								<Input
									className="flex-1"
									disabled={sendTestEmailMutation.isPending}
									onChange={(e) => setTestEmail(e.target.value)}
									placeholder="Admin Email"
									type="email"
									value={testEmail}
								/>
								<Button
									disabled={sendTestEmailMutation.isPending}
									type="submit"
								>
									{sendTestEmailMutation.isPending ? "Sending..." : "Test"}
								</Button>
							</div>
							<Select
								disabled={sendTestEmailMutation.isPending}
								onValueChange={(value) =>
									setTestEmailType(
										value as
											| "basic"
											| "password-reset"
											| "credential-change"
											| "email-verification",
									)
								}
								value={testEmailType}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select email type to test" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="basic">Basic Test Email</SelectItem>
									<SelectItem value="password-reset">
										Password Reset Sample
									</SelectItem>
									<SelectItem value="credential-change">
										Credential Change Sample
									</SelectItem>
									<SelectItem value="email-verification">
										Verification Sample
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<p className="text-[10px] text-muted-foreground">
							Send a test email to verify SMTP configuration and preview
							templates.
						</p>
					</form>
				)}
			</CardContent>
		</Card>
	);
}

function AiSettingsCard({
	aiSettings,
	isUpdating,
	onUpdate,
}: {
	aiSettings?: {
		defaultAiMode: string;
		externalAiAccessMode: string;
		monthlyAiTokenQuota: number;
		openRouterConfigured: boolean;
	} | null;
	isUpdating: boolean;
	onUpdate: (updates: {
		defaultAiMode?: "LOCAL" | "EXTERNAL";
		externalAiAccessMode?: "WHITELIST" | "BLACKLIST";
		monthlyAiTokenQuota?: number;
	}) => Promise<void>;
}) {
	const [quotaInput, setQuotaInput] = useState("");

	useEffect(() => {
		if (aiSettings?.monthlyAiTokenQuota != null) {
			setQuotaInput(String(aiSettings.monthlyAiTokenQuota));
		}
	}, [aiSettings?.monthlyAiTokenQuota]);

	const saveQuota = () => {
		const val = parseInt(quotaInput, 10);
		if (!isNaN(val) && val >= 0 && val !== aiSettings?.monthlyAiTokenQuota) {
			void onUpdate({ monthlyAiTokenQuota: val });
		}
	};

	return (
		<Card className="flex h-full flex-col">
			<CardHeader>
				<CardTitle>AI Processing</CardTitle>
				<CardDescription>
					Configure external AI provider for bank statement imports.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-grow flex-col space-y-4">
				<div className="flex items-center gap-2">
					<div
						className={`h-2.5 w-2.5 rounded-full ${
							aiSettings?.openRouterConfigured ? "bg-green-500" : "bg-destructive"
						}`}
					/>
					<span className="font-medium text-sm">
						OpenRouter:{" "}
						{aiSettings?.openRouterConfigured
							? "API Key Configured"
							: "Not Configured"}
					</span>
				</div>

				<div className="space-y-2">
					<label className="font-medium text-sm" htmlFor="default-ai-mode">
						Default AI Mode
					</label>
					<Select
						disabled={isUpdating}
						onValueChange={(value) =>
							onUpdate({ defaultAiMode: value as "LOCAL" | "EXTERNAL" })
						}
						value={aiSettings?.defaultAiMode ?? "LOCAL"}
					>
						<SelectTrigger id="default-ai-mode">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="LOCAL">Local (Ollama)</SelectItem>
							<SelectItem value="EXTERNAL">External (OpenRouter)</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<label className="font-medium text-sm" htmlFor="ai-access-mode">
						Access Control Mode
					</label>
					<Select
						disabled={isUpdating}
						onValueChange={(value) =>
							onUpdate({
								externalAiAccessMode: value as "WHITELIST" | "BLACKLIST",
							})
						}
						value={aiSettings?.externalAiAccessMode ?? "WHITELIST"}
					>
						<SelectTrigger id="ai-access-mode">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="WHITELIST">
								Whitelist (deny by default)
							</SelectItem>
							<SelectItem value="BLACKLIST">
								Blacklist (allow by default)
							</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-[10px] text-muted-foreground">
						{aiSettings?.externalAiAccessMode === "WHITELIST"
							? "Users must be explicitly allowed to use external AI."
							: "All users can use external AI unless explicitly denied."}
					</p>
				</div>

				<div className="space-y-2">
					<label className="font-medium text-sm" htmlFor="ai-token-quota">
						Monthly Token Quota per User
					</label>
					<Input
						disabled={isUpdating}
						id="ai-token-quota"
						min={0}
						onChange={(e) => setQuotaInput(e.target.value)}
						onBlur={saveQuota}
						onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveQuota(); } }}
						type="number"
						value={quotaInput}
					/>
					<p className="text-[10px] text-muted-foreground">
						{(aiSettings?.monthlyAiTokenQuota ?? 2000000).toLocaleString()}{" "}
						tokens
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
