"use client";

import { Award, Receipt, Wallet } from "lucide-react";
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
import { StatCard } from "~/components/ui/stat-card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
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

	// Fetch lifetime stats
	const { data: lifetimeStats } = api.stats.getLifetimeStats.useQuery(
		{},
		{ enabled: !!session?.user },
	);

	const { formatCurrency } = useCurrencyFormatter();

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
			{/* Lifetime Stats Row */}
			<div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
				<StatCard
					icon={Wallet}
					title="TOTAL TRACKED VOLUME"
					value={formatCurrency(lifetimeStats?.totalSpent || 0)}
					variant="blue"
				/>
				<StatCard
					icon={Receipt}
					title="TOTAL TRANSACTIONS"
					value={lifetimeStats?.totalTransactions.toLocaleString() || "0"}
					variant="violet"
				/>
				<StatCard
					icon={Award}
					title="MEMBER SINCE"
					value={new Date(user.createdAt).toLocaleDateString("en-US", {
						month: "short",
						year: "numeric",
					})}
					variant="amber"
				/>
			</div>

			<ProfileForm user={user} />

			<PasswordForm />

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
