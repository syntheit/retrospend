"use client";

import {
	Bot,
	BotOff,
	Link,
	Lock,
	LockOpen,
	MailCheck,
	MailWarning,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import type { VisibilityState } from "@tanstack/react-table";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { DataTable } from "~/components/data-table";
import { createUserColumns, type User } from "./users-table-columns";

interface UsersTableProps {
	users: User[];
	currentUserId?: string;
	onResetPassword: (userId: string, username: string) => void;
	onToggleUserStatus: (
		userId: string,
		username: string,
		isActive: boolean,
	) => void;
	onMarkEmailVerified: (
		userId: string,
		username: string,
		verified: boolean,
	) => void;
	onDeleteUser: (userId: string, username: string) => void;
	onSetAiAccess?: (userId: string, allowed: boolean | null) => void;
}

export function UsersTable({
	users,
	currentUserId,
	onResetPassword,
	onToggleUserStatus,
	onMarkEmailVerified,
	onDeleteUser,
	onSetAiAccess,
}: UsersTableProps) {
	const isMobile = useIsMobile();

	const generateResetLinkMutation =
		api.admin.generatePasswordResetLink.useMutation({
			onSuccess: (data) => {
				navigator.clipboard.writeText(data.resetUrl);
				toast.success("Reset link copied to clipboard");
			},
			onError: (error) => {
				toast.error(error.message || "Failed to generate link");
			},
		});

	const columns = useMemo(
		() =>
			createUserColumns(currentUserId, {
				onResetPassword,
				onToggleUserStatus,
				onMarkEmailVerified,
				onDeleteUser,
				onSetAiAccess,
				onCopyResetLink: (userId: string) =>
					generateResetLinkMutation.mutate({ userId }),
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[currentUserId, onResetPassword, onToggleUserStatus, onMarkEmailVerified, onDeleteUser, onSetAiAccess],
	);

	const columnVisibility: VisibilityState = isMobile
		? { features: false, expenseCount: false, createdAt: false }
		: {};

	const renderContextMenu = useMemo(() => {
		return (user: User) => (
			<>
				{user.id !== currentUserId && (
					<>
						<ContextMenuItem
							onClick={() => onResetPassword(user.id, user.username)}
						>
							<RefreshCw className="mr-2 h-4 w-4" />
							Reset Password
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() =>
								generateResetLinkMutation.mutate({ userId: user.id })
							}
						>
							<Link className="mr-2 h-4 w-4" />
							Copy Reset Link
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() =>
								onToggleUserStatus(user.id, user.username, user.isActive)
							}
						>
							{user.isActive ? (
								<>
									<Lock className="mr-2 h-4 w-4" />
									Disable User
								</>
							) : (
								<>
									<LockOpen className="mr-2 h-4 w-4" />
									Enable User
								</>
							)}
						</ContextMenuItem>
					</>
				)}
				{user.emailVerified ? (
					<ContextMenuItem
						onClick={() =>
							onMarkEmailVerified(user.id, user.username, false)
						}
					>
						<MailWarning className="mr-2 h-4 w-4" />
						Mark Email Unverified
					</ContextMenuItem>
				) : (
					<ContextMenuItem
						onClick={() =>
							onMarkEmailVerified(user.id, user.username, true)
						}
					>
						<MailCheck className="mr-2 h-4 w-4" />
						Mark Email Verified
					</ContextMenuItem>
				)}
				{onSetAiAccess && user.id !== currentUserId && (
					<>
						<ContextMenuSeparator />
						{user.externalAiAllowed === true ? (
							<ContextMenuItem
								onClick={() => onSetAiAccess(user.id, null)}
							>
								<BotOff className="mr-2 h-4 w-4" />
								Revoke External AI Access
							</ContextMenuItem>
						) : (
							<ContextMenuItem
								onClick={() => onSetAiAccess(user.id, true)}
							>
								<Bot className="mr-2 h-4 w-4" />
								Allow External AI Access
							</ContextMenuItem>
						)}
					</>
				)}
				{user.id !== currentUserId && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={() => onDeleteUser(user.id, user.username)}
							variant="destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete User
						</ContextMenuItem>
					</>
				)}
			</>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentUserId, onResetPassword, onToggleUserStatus, onMarkEmailVerified, onDeleteUser, onSetAiAccess]);

	return (
		<DataTable
			columns={columns}
			columnVisibility={columnVisibility}
			data={users}
			progressive
			renderContextMenu={renderContextMenu}
			searchable
			searchPlaceholder="Search users..."
		/>
	);
}
