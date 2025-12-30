"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { ActionDialog } from "./action-dialog";
import { InviteCodesTable } from "./invite-codes-table";
import { UsersTable } from "./users-table";

// Extend the session user type to include additional fields
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
	| null;

export function AdminPanel() {
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [resetResult, setResetResult] = useState<{
		newPassword: string;
	} | null>(null);

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
		data: inviteCodes,
		isLoading: inviteCodesLoading,
		refetch: refetchInviteCodes,
	} = api.invite.list.useQuery(undefined, {
		enabled: isAdmin,
	});
	const { data: settings, refetch: refetchSettings } =
		api.admin.getSettings.useQuery(undefined, {
			enabled: isAdmin,
		});

	const resetPasswordMutation = api.admin.resetPassword.useMutation();
	const disableUserMutation = api.admin.disableUser.useMutation();
	const enableUserMutation = api.admin.enableUser.useMutation();
	const deleteUserMutation = api.admin.deleteUser.useMutation();
	const deleteInviteCodeMutation = api.invite.delete.useMutation();
	const updateSettingsMutation = api.admin.updateSettings.useMutation();

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
			});
			toast.success(`Invite-only signups ${enabled ? "enabled" : "disabled"}`);
			refetchSettings();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to update settings";
			toast.error(message);
		}
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
		}
	};

	const dialogContent = getDialogContent();
	const isLoadingAction =
		resetPasswordMutation.isPending ||
		disableUserMutation.isPending ||
		enableUserMutation.isPending ||
		deleteUserMutation.isPending ||
		deleteInviteCodeMutation.isPending;

	// This component should only be rendered for admin users
	// The admin page already checks this, but this provides additional safety
	if (!isAdmin) {
		return null;
	}

	return (
		<>
			<SiteHeader title="Admin Panel" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="font-bold text-2xl tracking-tight">
								User Management
							</h2>
							<p className="text-muted-foreground">
								Manage users, reset passwords, and control account access.
							</p>
						</div>
					</div>

					<UsersTable
						currentUserId={session?.user?.id}
						isLoading={isLoading}
						onDeleteUser={(userId, username) =>
							handleAction({ type: "deleteUser", userId, username })
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
						users={users || []}
					/>

					<Card>
						<CardHeader>
							<CardTitle>Registration Settings</CardTitle>
							<CardDescription>
								Control how new users can sign up for the application.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<label
										className="font-medium text-sm"
										htmlFor="invite-codes-switch"
									>
										Require Invite Codes
									</label>
									<p className="text-muted-foreground text-sm">
										When enabled, new users must provide a valid invite code to
										sign up. When disabled, anyone can create an account.
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
								className={`flex items-center justify-between ${!(settings?.inviteOnlyEnabled ?? false) ? "opacity-50" : ""}`}
							>
								<div className="space-y-0.5">
									<label
										className={`font-medium text-sm ${!(settings?.inviteOnlyEnabled ?? false) ? "text-muted-foreground" : ""}`}
										htmlFor="user-invite-codes-switch"
									>
										Allow All Users to Generate Invite Codes
									</label>
									<p className="text-muted-foreground text-sm">
										When enabled, all authenticated users can create and manage
										their own invite codes.
									</p>
								</div>
								<Switch
									checked={settings?.allowAllUsersToGenerateInvites ?? false}
									disabled={
										updateSettingsMutation.isPending ||
										!(settings?.inviteOnlyEnabled ?? false)
									}
									id="user-invite-codes-switch"
									onCheckedChange={async (enabled: boolean) => {
										try {
											await updateSettingsMutation.mutateAsync({
												inviteOnlyEnabled: settings?.inviteOnlyEnabled ?? false,
												allowAllUsersToGenerateInvites: enabled,
											});
											toast.success(
												`User invite code generation ${enabled ? "enabled" : "disabled"}`,
											);
											refetchSettings();
										} catch (error) {
											const message =
												error instanceof Error
													? error.message
													: "Failed to update settings";
											toast.error(message);
										}
									}}
								/>
							</div>
						</CardContent>
					</Card>

					<InviteCodesTable
						inviteCodes={inviteCodes || []}
						isLoading={inviteCodesLoading}
						onDeleteCode={(inviteCodeId, code) =>
							handleAction({ type: "deleteInviteCode", inviteCodeId, code })
						}
						onGenerateCode={refetchInviteCodes}
					/>
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
