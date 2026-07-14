"use client";

import { Award, Receipt, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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
	const t = useTranslations("account");
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
					<div className="text-center">{t("loading")}</div>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="text-center">
						{t("pleaseSignIn")}
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
					title={t("totalTrackedVolume")}
					value={formatCurrency(lifetimeStats?.totalSpent || 0)}
					variant="blue"
				/>
				<StatCard
					icon={Receipt}
					title={t("totalTransactions")}
					value={lifetimeStats?.totalTransactions.toLocaleString() || "0"}
					variant="violet"
				/>
				<StatCard
					icon={Award}
					title={t("memberSince")}
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
	const t = useTranslations("account");
	const router = useRouter();
	const [password, setPassword] = useState("");
	const deleteAccount = api.user.deleteAccount.useMutation({
		onSuccess: () => {
			toast.success(t("accountDeleted"));
			router.push("/login");
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const handleClose = () => {
		setPassword("");
		onCloseModal();
	};

	return (
		<>
			<Card className="border-red-200 dark:border-red-800">
				<CardContent className="p-6">
					<div className="flex items-center justify-between">
						<div>
							<p className="font-medium text-red-600 dark:text-red-400">
								{t("deleteAccount")}
							</p>
							<p className="text-muted-foreground text-sm">
								{t("permanentlyRemove")}
							</p>
						</div>
						<Button
							className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
							onClick={onOpenDelete}
							variant="outline"
						>
							{t("delete")}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Dialog onOpenChange={handleClose} open={showModal}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("deleteAccount")}</DialogTitle>
						<DialogDescription>
							{t("areYouSure")}
						</DialogDescription>
					</DialogHeader>
					<div className="py-2">
						<Label htmlFor="delete-password">{t("password")}</Label>
						<Input
							className="mt-2"
							id="delete-password"
							onChange={(e) => setPassword(e.target.value)}
							placeholder={t("enterYourPassword")}
							type="password"
							value={password}
						/>
					</div>
					<DialogFooter>
						<Button
							disabled={deleteAccount.isPending}
							onClick={handleClose}
							variant="ghost"
						>
							{t("cancel")}
						</Button>
						<Button
							disabled={deleteAccount.isPending || !password}
							onClick={() => deleteAccount.mutate({ password })}
							variant="destructive"
						>
							{deleteAccount.isPending ? t("deleting") : t("deleteAccount")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
