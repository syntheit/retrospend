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
import { useTranslations } from "next-intl";
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
	const t = useTranslations("admin");
	const isMobile = useIsMobile();

	const generateResetLinkMutation =
		api.admin.generatePasswordResetLink.useMutation({
			onSuccess: (data) => {
				navigator.clipboard.writeText(data.resetUrl);
				toast.success(t("resetLinkCopied"));
			},
			onError: (error) => {
				toast.error(error.message || t("failedToGenerateLink"));
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
			}, t),
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
							{t("resetPassword")}
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() =>
								generateResetLinkMutation.mutate({ userId: user.id })
							}
						>
							<Link className="mr-2 h-4 w-4" />
							{t("copyResetLink")}
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() =>
								onToggleUserStatus(user.id, user.username, user.isActive)
							}
						>
							{user.isActive ? (
								<>
									<Lock className="mr-2 h-4 w-4" />
									{t("disableUser")}
								</>
							) : (
								<>
									<LockOpen className="mr-2 h-4 w-4" />
									{t("enableUser")}
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
						{t("markEmailUnverifiedAction")}
					</ContextMenuItem>
				) : (
					<ContextMenuItem
						onClick={() =>
							onMarkEmailVerified(user.id, user.username, true)
						}
					>
						<MailCheck className="mr-2 h-4 w-4" />
						{t("markEmailVerifiedAction")}
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
								{t("revokeExternalAiAccess")}
							</ContextMenuItem>
						) : (
							<ContextMenuItem
								onClick={() => onSetAiAccess(user.id, true)}
							>
								<Bot className="mr-2 h-4 w-4" />
								{t("allowExternalAiAccess")}
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
							{t("deleteUser")}
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
			countNoun={t("usersNoun")}
			data={users}
			progressive
			renderContextMenu={renderContextMenu}
			searchable
			searchPlaceholder={t("searchUsers")}
		/>
	);
}
