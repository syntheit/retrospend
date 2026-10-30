import type { useTranslations } from "next-intl";

export type PendingAction =
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

export function dialogContentFor(
	pendingAction: PendingAction,
	t: ReturnType<typeof useTranslations<"admin">>,
) {
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
	}
