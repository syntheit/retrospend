"use client";

import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { UserInviteCodesTable } from "~/components/user-invite-codes-table";
import { api } from "~/trpc/react";

export default function InviteCodesPage() {
	const {
		data: inviteCodes,
		isLoading,
		refetch,
	} = api.invite.listUserCodes.useQuery();
	const deleteMutation = api.invite.deleteUserCode.useMutation();

	const handleDeleteCode = async (inviteCodeId: string, code: string) => {
		try {
			await deleteMutation.mutateAsync({ id: inviteCodeId });
			toast.success(`Invite code ${code} has been deleted`);
			refetch();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to delete invite code";
			toast.error(message);
		}
	};

	return (
		<>
			<SiteHeader title="Invite Codes" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<UserInviteCodesTable
						inviteCodes={inviteCodes || []}
						isLoading={isLoading}
						onGenerateCode={refetch}
						onDeleteCode={handleDeleteCode}
					/>
				</div>
			</PageContent>
		</>
	);
}
