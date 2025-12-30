"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

// Extend the session user type to include username and role
type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
	role: string;
};

export function AccountForm() {
	const { data: session, isPending: sessionLoading } = useSession();
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [showPasswordDialog, setShowPasswordDialog] = useState(false);
	const [error, setError] = useState("");
	const [passwordError, setPasswordError] = useState("");
	const [formData, setFormData] = useState({
		name: "",
		username: "",
		email: "",
		currentPassword: "",
		password: "",
		confirmPassword: "",
	});
	const router = useRouter();

	// Check if user is admin
	const extendedUser = session?.user as ExtendedUser;
	const isAdmin = extendedUser?.role === "ADMIN";

	// tRPC mutations
	const updateProfileMutation = api.user.updateProfile.useMutation();
	const deleteAccountMutation = api.user.deleteAccount.useMutation();
	const exportAllDataMutation = api.user.exportAllData.useMutation();

	// Populate form data when session loads
	useEffect(() => {
		if (session?.user) {
			setFormData({
				name: session.user.name || "",
				username: (session.user as ExtendedUser).username || "",
				email: session.user.email || "",
				currentPassword: "",
				password: "",
				confirmPassword: "",
			});
		}
	}, [session]);

	const handleInputChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		if (error) setError("");
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		try {
			await updateProfileMutation.mutateAsync({
				name: formData.name,
				username: formData.username,
				email: formData.email,
			});

			// Redirect to home on success
			router.push("/app");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to update account";
			setError(message);
		}
	};

	const handleExportAllData = async () => {
		try {
			const { zipData, filename } = await exportAllDataMutation.mutateAsync();
			// Convert base64 string back to Uint8Array
			const binaryString = atob(zipData as string);
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
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : "Failed to export user data");
		}
	};

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setPasswordError("");

		// Validate passwords match
		if (formData.password && formData.password !== formData.confirmPassword) {
			setPasswordError("Passwords do not match");
			return;
		}

		if (!formData.currentPassword) {
			setPasswordError("Current password is required");
			return;
		}

		if (!formData.password) {
			setPasswordError("New password is required");
			return;
		}

		try {
			await updateProfileMutation.mutateAsync({
				name: formData.name,
				username: formData.username,
				email: formData.email,
				password: formData.password,
				currentPassword: formData.currentPassword,
			});

			// Clear password fields and close dialog
			setFormData((prev) => ({
				...prev,
				currentPassword: "",
				password: "",
				confirmPassword: "",
			}));
			setShowPasswordDialog(false);
			router.push("/app");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to update password";
			setPasswordError(message);
		}
	};

	const handleDeleteAccount = async () => {
		try {
			await deleteAccountMutation.mutateAsync();
			// On successful deletion, redirect to login or home
			router.push("/login");
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to delete account";
			setError(message);
			setShowDeleteModal(false);
		}
	};

	if (sessionLoading) {
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

	return (
		<>
			<Card className="mx-auto w-full max-w-2xl">
				<CardHeader>
					<CardTitle>Account Settings</CardTitle>
					<CardDescription>
						Update your account information and manage your settings.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSave}>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="name">Full Name</Label>
								<Input
									disabled={updateProfileMutation.isPending}
									id="name"
									onChange={(e) => handleInputChange("name", e.target.value)}
									type="text"
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
										disabled={updateProfileMutation.isPending}
										id="username"
										onChange={(e) =>
											handleInputChange("username", e.target.value)
										}
										type="text"
										value={formData.username}
									/>
								</div>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								disabled={updateProfileMutation.isPending}
								id="email"
								onChange={(e) => handleInputChange("email", e.target.value)}
								type="email"
								value={formData.email}
							/>
							<Button
								className="mt-2"
								onClick={() => setShowPasswordDialog(true)}
								type="button"
								variant="outline"
							>
								Change Password
							</Button>
						</div>
						{error && (
							<div className="text-red-600 text-sm dark:text-red-400">
								{error}
							</div>
						)}
						<div className="flex gap-4 pt-2">
							<Button
								className="flex-1"
								disabled={updateProfileMutation.isPending}
								type="submit"
							>
								{updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{/* Password Change Dialog */}
			<Dialog onOpenChange={setShowPasswordDialog} open={showPasswordDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Change Password</DialogTitle>
						<DialogDescription>
							Update your password. You'll need to enter your current password
							for security.
						</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleChangePassword}>
						<div className="space-y-2">
							<Label htmlFor="dialogCurrentPassword">Current Password</Label>
							<Input
								disabled={updateProfileMutation.isPending}
								id="dialogCurrentPassword"
								onChange={(e) =>
									handleInputChange("currentPassword", e.target.value)
								}
								type="password"
								value={formData.currentPassword}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dialogPassword">New Password</Label>
							<Input
								disabled={updateProfileMutation.isPending}
								id="dialogPassword"
								onChange={(e) => handleInputChange("password", e.target.value)}
								type="password"
								value={formData.password}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dialogConfirmPassword">
								Confirm New Password
							</Label>
							<Input
								disabled={updateProfileMutation.isPending}
								id="dialogConfirmPassword"
								onChange={(e) =>
									handleInputChange("confirmPassword", e.target.value)
								}
								type="password"
								value={formData.confirmPassword}
							/>
						</div>
						{passwordError && (
							<div className="text-red-600 text-sm dark:text-red-400">
								{passwordError}
							</div>
						)}
						<DialogFooter>
							<Button
								disabled={updateProfileMutation.isPending}
								onClick={() => {
									setShowPasswordDialog(false);
									setPasswordError("");
									setFormData((prev) => ({
										...prev,
										currentPassword: "",
										password: "",
										confirmPassword: "",
									}));
								}}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button disabled={updateProfileMutation.isPending} type="submit">
								{updateProfileMutation.isPending
									? "Updating..."
									: "Update Password"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Export Data Card */}
			<Card className="mx-auto w-full max-w-2xl">
				<CardContent className="space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1">
							<p className="font-medium">Export all user data</p>
							<p className="text-muted-foreground text-sm">
								Download all your personal data including profile, expenses,
								wealth, categories, and favorite exchange rates as CSV files in
								a zip archive.
							</p>
						</div>
						<Button
							className="w-full sm:w-auto"
							disabled={exportAllDataMutation.isPending}
							onClick={handleExportAllData}
							variant="outline"
						>
							{exportAllDataMutation.isPending
								? "Preparing..."
								: "Download ZIP"}
							<Download className="ml-2 h-4 w-4" />
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Danger Zone - Only show for non-admin users */}
			{!isAdmin && (
				<Card className="mx-auto w-full max-w-2xl border-red-200 dark:border-red-800">
					<CardContent>
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
								className="border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
								disabled={deleteAccountMutation.isPending}
								onClick={() => setShowDeleteModal(true)}
								variant="outline"
							>
								Delete
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Delete Account Dialog - Only render for non-admin users */}
			{!isAdmin && (
				<Dialog onOpenChange={setShowDeleteModal} open={showDeleteModal}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Delete Account</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete your account? This action cannot
								be undone. All your data will be permanently removed.
							</DialogDescription>
							<div className="mt-2 text-muted-foreground text-sm">
								You can export your data in settings before deleting your
								account.
							</div>
						</DialogHeader>
						<DialogFooter>
							<Button
								disabled={deleteAccountMutation.isPending}
								onClick={() => setShowDeleteModal(false)}
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={deleteAccountMutation.isPending}
								onClick={handleDeleteAccount}
								variant="destructive"
							>
								{deleteAccountMutation.isPending
									? "Deleting..."
									: "Delete Account"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
