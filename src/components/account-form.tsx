"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
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
	const [showPasswordDialog, setShowPasswordDialog] = useState(false);

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
			<ProfileSection
				onOpenPasswordChange={() => setShowPasswordDialog(true)}
				user={user}
			/>

			<ExportDataSection />

			{!isAdmin && (
				<DeleteAccountSection
					onCloseModal={() => setShowDeleteModal(false)}
					onOpenDelete={() => setShowDeleteModal(true)}
					showModal={showDeleteModal}
				/>
			)}

			<PasswordChangeDialog
				isOpen={showPasswordDialog}
				onOpenChange={setShowPasswordDialog}
				user={user}
			/>
		</div>
	);
}

interface ProfileSectionProps {
	user: ExtendedUser;
	onOpenPasswordChange: () => void;
}

function ProfileSection({ user, onOpenPasswordChange }: ProfileSectionProps) {
	const router = useRouter();
	const [formData, setFormData] = useState({
		name: user.name ?? "",
		username: user.username ?? "",
		email: user.email ?? "",
	});
	const [error, setError] = useState("");

	const updateProfile = api.user.updateProfile.useMutation({
		onSuccess: () => {
			toast.success("Profile updated");
			router.push("/app");
		},
		onError: (err) => setError(err.message),
	});

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		updateProfile.mutate(formData);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Account Settings</CardTitle>
				<CardDescription>Update your account information.</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-4" onSubmit={handleSave}>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="name">Full Name</Label>
							<Input
								disabled={updateProfile.isPending}
								id="name"
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, name: e.target.value }))
								}
								value={formData.name}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="username">Username</Label>
							<div className="relative">
								<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
									@
								</span>
								<Input
									className="pl-6"
									disabled={updateProfile.isPending}
									id="username"
									onChange={(e) =>
										setFormData((prev) => ({
											...prev,
											username: e.target.value,
										}))
									}
									value={formData.username}
								/>
							</div>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input
							disabled={updateProfile.isPending}
							id="email"
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, email: e.target.value }))
							}
							type="email"
							value={formData.email}
						/>
						<Button
							className="mt-2"
							onClick={onOpenPasswordChange}
							type="button"
							variant="outline"
						>
							Change Password
						</Button>
					</div>
					{error && <p className="text-red-500 text-sm">{error}</p>}
					<Button
						className="w-full"
						disabled={updateProfile.isPending}
						type="submit"
					>
						{updateProfile.isPending ? "Saving..." : "Save Changes"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function ExportDataSection() {
	const exportData = api.user.exportAllData.useMutation();

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

interface PasswordChangeDialogProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	user: ExtendedUser;
}

function PasswordChangeDialog({
	isOpen,
	onOpenChange,
	user,
}: PasswordChangeDialogProps) {
	const [formData, setFormData] = useState({
		currentPassword: "",
		password: "",
		confirmPassword: "",
	});
	const [error, setError] = useState("");

	const updateProfile = api.user.updateProfile.useMutation({
		onSuccess: () => {
			toast.success("Password updated");
			onOpenChange(false);
			setFormData({ currentPassword: "", password: "", confirmPassword: "" });
		},
		onError: (err) => setError(err.message),
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (!formData.currentPassword || !formData.password) {
			setError("All fields are required");
			return;
		}

		if (formData.password !== formData.confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		updateProfile.mutate({
			name: user.name ?? "",
			username: user.username,
			email: user.email ?? "",
			currentPassword: formData.currentPassword,
			password: formData.password,
		});
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setError("");
					setFormData({
						currentPassword: "",
						password: "",
						confirmPassword: "",
					});
				}
				onOpenChange(open);
			}}
			open={isOpen}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Change Password</DialogTitle>
					<DialogDescription>
						Update your security credentials.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor="currentPassword">Current Password</Label>
						<Input
							disabled={updateProfile.isPending}
							id="currentPassword"
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									currentPassword: e.target.value,
								}))
							}
							type="password"
							value={formData.currentPassword}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="newPassword">New Password</Label>
						<Input
							disabled={updateProfile.isPending}
							id="newPassword"
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, password: e.target.value }))
							}
							type="password"
							value={formData.password}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="confirmPassword">Confirm New Password</Label>
						<Input
							disabled={updateProfile.isPending}
							id="confirmPassword"
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									confirmPassword: e.target.value,
								}))
							}
							type="password"
							value={formData.confirmPassword}
						/>
					</div>
					{error && <p className="text-red-500 text-sm">{error}</p>}
					<DialogFooter>
						<Button
							disabled={updateProfile.isPending}
							onClick={() => onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={updateProfile.isPending} type="submit">
							{updateProfile.isPending ? "Updating..." : "Update Password"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
