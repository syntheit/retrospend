"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { UserInviteCodesTable } from "~/components/user-invite-codes-table";
import { api } from "~/trpc/react";

export default function InviteCodesPage() {
	const utils = api.useUtils();
	const [status, setStatus] = useState<"active" | "used">("active");

	const { data, isLoading } = api.invite.listUserCodes.useQuery({
		status,
		page: 1,
		pageSize: 100,
	});

	const deleteMutation = api.invite.deleteUserCode.useMutation({
		onSuccess: () => {
			void utils.invite.listUserCodes.invalidate();
		},
	});

	const handleRefetch = () => {
		void utils.invite.listUserCodes.invalidate();
	};

	const handleDeleteCode = (inviteCodeId: string, code: string) => {
		deleteMutation.mutate(
			{ id: inviteCodeId },
			{
				onSuccess: () => {
					toast.success(`Invite code ${code} has been deleted`);
				},
				onError: (error) => {
					toast.error(error.message || "Failed to delete invite code");
				},
			},
		);
	};

	return (
		<>
			<SiteHeader title="Invite Codes" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<UserInviteCodesTable
						inviteCodes={data?.items || []}
						isLoading={isLoading}
						onDeleteCode={handleDeleteCode}
						onGenerateCode={handleRefetch}
						onStatusChange={setStatus}
						status={status}
					/>
				</div>
			</PageContent>
		</>
	);
}
