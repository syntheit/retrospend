"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PasswordForm } from "~/components/settings/password-form";
import { ProfileForm } from "~/components/settings/profile-form";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
	role: string;
};

export function AccountForm() {
	const { data: session, isPending } = useSession();
	const [showDeleteModal, setShowDeleteModal] = useState(false);

	if (isPending) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="text-center">Loading...</div>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="text-center">
						Please sign in to access your account
					</div>
				</CardContent>
			</Card>
		);
	}

	const user = session.user as ExtendedUser;
	const isAdmin = user.role === "ADMIN";

	return (
		<div className="mx-auto w-full max-w-2xl space-y-6">
			<ProfileForm user={user} />

			<PasswordForm user={user} />

			<ExportDataSection />

			{!isAdmin && (
				<DeleteAccountSection
					onCloseModal={() => setShowDeleteModal(false)}
					onOpenDelete={() => setShowDeleteModal(true)}
					showModal={showDeleteModal}
				/>
			)}
		</div>
	);
}

function ExportDataSection() {
	const exportData = api.exportData.allData.useMutation();

	const handleExport = async () => {
		try {
			const { zipData, filename } = await exportData.mutateAsync();
			const binaryString = atob(zipData);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: "application/zip" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("All user data exported");
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : "Failed to export data");
		}
	};

	return (
		<Card>
			<CardContent className="p-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium">Export all user data</p>
						<p className="text-muted-foreground text-sm">
							Download your data (expenses, wealth, etc.) as CSV files in a ZIP
							archive.
						</p>
					</div>
					<Button
						className="w-full sm:w-auto"
						disabled={exportData.isPending}
						onClick={handleExport}
						variant="outline"
					>
						{exportData.isPending ? "Preparing..." : "Download ZIP"}
						<Download className="ml-2 h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

interface DeleteAccountSectionProps {
	onOpenDelete: () => void;
	showModal: boolean;
	onCloseModal: () => void;
}

function DeleteAccountSection({
	onOpenDelete,
	showModal,
	onCloseModal,
}: DeleteAccountSectionProps) {
	const router = useRouter();
	const deleteAccount = api.user.deleteAccount.useMutation({
		onSuccess: () => {
			toast.success("Account deleted");
			router.push("/login");
		},
	});

	return (
		<>
			<Card className="border-red-200 dark:border-red-800">
				<CardContent className="p-6">
					<div className="flex items-center justify-between">
						<div>
							<p className="font-medium text-red-600 dark:text-red-400">
								Delete Account
							</p>
							<p className="text-muted-foreground text-sm">
								Permanently remove your account and all data.
							</p>
						</div>
						<Button
							className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
							onClick={onOpenDelete}
							variant="outline"
						>
							Delete
						</Button>
					</div>
				</CardContent>
			</Card>

			<Dialog onOpenChange={onCloseModal} open={showModal}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Account</DialogTitle>
						<DialogDescription>
							Are you sure? This action cannot be undone. All your data will be
							permanently removed.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteAccount.isPending}
							onClick={onCloseModal}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteAccount.isPending}
							onClick={() => deleteAccount.mutate()}
							variant="destructive"
						>
							{deleteAccount.isPending ? "Deleting..." : "Delete Account"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
