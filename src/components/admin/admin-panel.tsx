"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { RateSyncControl } from "~/components/rate-sync-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { ActionDialog } from "./action-dialog";
import { EmailSection } from "./admin-email-section";
import { AdminOverviewStats } from "./admin-overview-stats";
import {
	AiSettingsSection,
	type AiUpdate,
	RegistrationSection,
	type SettingsUpdate,
	SystemSection,
} from "./admin-settings-sections";
import { AiUsageTable } from "./ai-usage-table";
import { AuditLogsTable } from "./audit-logs-table";
import { BackupStatus } from "./backup-status";
import { InviteCodesTable } from "./invite-codes-table";
import { ParticipantsTable } from "./participants-table";
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
	const t = useTranslations("admin");
	const toast = useToast();
	const tabsRef = useRef<HTMLDivElement>(null);
	const defaultTab = "users";
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [resetResult, setResetResult] = useState<{
		newPassword: string;
	} | null>(null);

	// Filtering state for invite codes
	const [inviteCodesStatus, setInviteCodesStatus] = useState<"active" | "used">(
		"active",
	);

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
			pageSize: 100,
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
						toast.saved(
							t("userDisabled", { username: pendingAction.username }),
						);
					} else {
						await enableUserMutation.mutateAsync({
							userId: pendingAction.userId,
						});
						toast.saved(t("userEnabled", { username: pendingAction.username }));
					}
					break;

				case "deleteUser":
					await deleteUserMutation.mutateAsync({
						userId: pendingAction.userId,
					});
					toast.saved(t("userDeleted", { username: pendingAction.username }));
					break;

				case "deleteInviteCode":
					await deleteInviteCodeMutation.mutateAsync({
						id: pendingAction.inviteCodeId,
					});
					toast.saved(t("inviteCodeDeleted", { code: pendingAction.code }));
					await refetchInviteCodes();
					break;

				case "toggleEmailVerification":
					await toggleEmailVerificationMutation.mutateAsync({
						userId: pendingAction.userId,
						verified: pendingAction.verified,
					});
					toast.saved(
						pendingAction.verified
							? t("emailMarkedVerified", { username: pendingAction.username })
							: t("emailMarkedUnverified", {
									username: pendingAction.username,
								}),
					);
					break;
			}

			await refetch();
			setDialogOpen(false);
			setPendingAction(null);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : t("anErrorOccurred");
			toast.failed(message);
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

	const saveSettings = async (updates: SettingsUpdate, message: string) => {
		try {
			await updateSettingsMutation.mutateAsync(updates);
			toast.saved(message);
			await refetchSettings();
		} catch (error) {
			toast.failed(
				error instanceof Error ? error.message : t("failedToUpdateSettings"),
			);
		}
	};

	const saveAiSettings = async (updates: AiUpdate) => {
		try {
			await updateAiSettingsMutation.mutateAsync(updates);
			toast.saved(t("aiSettingsUpdated"));
			await refetchAiSettings();
		} catch (error) {
			toast.failed(
				error instanceof Error ? error.message : t("failedToUpdateAiSettings"),
			);
		}
	};

	const handleInviteCodesStatusChange = (newStatus: "active" | "used") => {
		setInviteCodesStatus(newStatus);
	};

	const getDialogContent = () => {
		if (!pendingAction) return null;

		switch (pendingAction.type) {
			case "resetPassword":
				return {
					title: t("resetPassword"),
					description: t("resetPasswordConfirm", {
						username: pendingAction.username,
					}),
					confirmLabel: t("resetPassword"),
					variant: "default" as const,
				};

			case "toggleUserStatus":
				return {
					title: pendingAction.isActive ? t("disableUser") : t("enableUser"),
					description: pendingAction.isActive
						? t("disableUserConfirm", { username: pendingAction.username })
						: t("enableUserConfirm", { username: pendingAction.username }),
					confirmLabel: pendingAction.isActive
						? t("disableUser")
						: t("enableUser"),
					variant: "default" as const,
				};

			case "deleteUser":
				return {
					title: t("deleteUser"),
					description: t("deleteUserConfirm", {
						username: pendingAction.username,
					}),
					confirmLabel: t("deleteUser"),
					variant: "destructive" as const,
				};

			case "deleteInviteCode":
				return {
					title: t("deleteInviteCode"),
					description: t("deleteInviteCodeConfirm", {
						code: pendingAction.code,
					}),
					confirmLabel: t("deleteCode"),
					variant: "destructive" as const,
				};

			case "toggleEmailVerification":
				return {
					title: pendingAction.verified
						? t("markEmailVerified")
						: t("markEmailUnverified"),
					description: pendingAction.verified
						? t("markEmailVerifiedConfirm", {
								username: pendingAction.username,
							})
						: t("markEmailUnverifiedConfirm", {
								username: pendingAction.username,
							}),
					confirmLabel: pendingAction.verified
						? t("markAsVerified")
						: t("markAsUnverified"),
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
		<PageFrame>
			<PageHeader title={t("adminPanel")} />
			<div className="flex flex-col gap-12">
				<AdminOverviewStats />

				<section
					aria-labelledby="admin-settings"
					className="flex flex-col gap-8"
				>
					<h2 className="text-fg text-section" id="admin-settings">
						{t("settings")}
					</h2>
					<RegistrationSection
						isUpdating={updateSettingsMutation.isPending}
						onSave={saveSettings}
						settings={settings}
					/>
					<EmailSection
						adminEmail={extendedUser?.email}
						isUpdating={updateSettingsMutation.isPending}
						onSave={saveSettings}
						settings={settings}
					/>
					<AiSettingsSection
						aiSettings={aiSettings}
						isUpdating={updateAiSettingsMutation.isPending}
						onUpdate={saveAiSettings}
					/>
					<SystemSection
						isUpdating={updateSettingsMutation.isPending}
						onSave={saveSettings}
						settings={settings}
					/>
				</section>

				<section aria-labelledby="admin-services">
					<h2 className="text-fg text-section" id="admin-services">
						{t("services")}
					</h2>
					<RateSyncControl />
					<BackupStatus />
				</section>

				{/* Data Management Tabs */}
				<Tabs
					defaultValue={defaultTab}
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
						<TabsTrigger value="users">{t("tabUsers")}</TabsTrigger>
						<TabsTrigger value="participants">
							{t("tabParticipants")}
						</TabsTrigger>
						<TabsTrigger value="invite-codes">
							{t("tabInviteCodes")}
						</TabsTrigger>
						<TabsTrigger value="ai-usage">{t("tabAiUsage")}</TabsTrigger>
						<TabsTrigger value="audit-logs">{t("tabAuditLogs")}</TabsTrigger>
					</TabsList>

					<TabsContent value="users">
						<UsersTable
							currentUserId={session?.user?.id}
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
							onSetAiAccess={async (userId, allowed) => {
								try {
									await setUserAiAccessMutation.mutateAsync({
										userId,
										externalAiAllowed: allowed,
									});
									toast.saved(t("aiAccessUpdated"));
									await refetch();
								} catch (error) {
									toast.failed(
										error instanceof Error
											? error.message
											: t("failedToUpdateAiAccess"),
									);
								}
							}}
							onToggleUserStatus={(userId, username, isActive) =>
								handleAction({
									type: "toggleUserStatus",
									userId,
									username,
									isActive,
								})
							}
							users={users || []}
						/>
					</TabsContent>

					<TabsContent value="participants">
						<ParticipantsTable />
					</TabsContent>

					<TabsContent value="invite-codes">
						<InviteCodesTable
							inviteCodes={inviteCodesData?.items || []}
							isLoading={inviteCodesLoading}
							onDeleteCode={(inviteCodeId, code) =>
								handleAction({ type: "deleteInviteCode", inviteCodeId, code })
							}
							onGenerateCode={refetchInviteCodes}
							onStatusChange={handleInviteCodesStatusChange}
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
		</PageFrame>
	);
}
