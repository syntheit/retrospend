"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useToast } from "~/components/ui/toast";
import { UserInviteCodesTable } from "~/components/user-invite-codes-table";
import { api } from "~/trpc/react";

export default function InviteCodesPage() {
	const t = useTranslations("inviteCodes");
	const toast = useToast();
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
					toast.saved(t("deleted", { code }));
				},
				onError: (error) => {
					toast.failed(error.message || t("deleteFailed"));
				},
			},
		);
	};

	return (
		<PageFrame>
			<PageHeader title={t("title")} />
			<UserInviteCodesTable
				inviteCodes={data?.items || []}
				isLoading={isLoading}
				onDeleteCode={handleDeleteCode}
				onGenerateCode={handleRefetch}
				onStatusChange={setStatus}
				status={status}
			/>
		</PageFrame>
	);
}
