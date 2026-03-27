"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import type { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

// TODO: Move this type to a shared location if reused frequently
type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
	role: string;
};

const profileSchema = z.object({
	name: z.string().min(1, "Name is required").max(100),
	username: z
		.string()
		.min(1, "Username is required")
		.max(50)
		.regex(
			/^[a-zA-Z0-9]+$/,
			"Username can only contain letters and numbers",
		),
	email: z.string().email("Invalid email address").max(254),
	currentPassword: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface ProfileFormProps {
	user: ExtendedUser;
}

export function ProfileForm({ user }: ProfileFormProps) {
	const router = useRouter();
	const utils = api.useUtils();

	const pendingEmailQuery = api.profile.getPendingEmail.useQuery();
	const cancelPendingEmail = api.profile.cancelPendingEmailChange.useMutation({
		onSuccess: () => {
			toast.success("Pending email change cancelled");
			void utils.profile.getPendingEmail.invalidate();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const updateProfile = api.profile.update.useMutation({
		onSuccess: (data) => {
			if ("emailChangePending" in data && data.emailChangePending) {
				toast.success(
					"Verification email sent to your new address. Check your inbox to confirm.",
				);
				void utils.profile.getPendingEmail.invalidate();
			} else {
				toast.success("Profile updated");
			}
			router.refresh();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const [showPasswordField, setShowPasswordField] = useState(false);

	const form = useForm<ProfileFormValues>({
		resolver: zodResolver(profileSchema),
		values: {
			name: user.name ?? "",
			username: user.username ?? "",
			email: user.email ?? "",
			currentPassword: "",
		},
	});

	const watchedUsername = form.watch("username");
	const usernameChanged =
		watchedUsername.toLowerCase() !== (user.username ?? "").toLowerCase();

	const watchedEmail = form.watch("email");
	const emailChanged = watchedEmail !== (user.email ?? "");

	useEffect(() => {
		setShowPasswordField(emailChanged);
		if (!emailChanged) {
			form.setValue("currentPassword", "");
		}
	}, [emailChanged, form]);

	const onSubmit = (values: ProfileFormValues) => {
		updateProfile.mutate(values);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile Information</CardTitle>
				<CardDescription>
					Update your account's profile information and email address.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form
						className="space-y-4"
						id="profileForm"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Full Name</FormLabel>
										<FormControl>
											<Input placeholder="Your name" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="username"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Username</FormLabel>
										<FormControl>
											<div className="relative">
												<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
													@
												</span>
												<Input
													autoComplete="one-time-code"
													className="pl-6"
													data-1p-ignore
													data-bwignore
													data-lpignore="true"
													placeholder="username"
													{...field}
												/>
											</div>
										</FormControl>
										<FormMessage />
										{usernameChanged && (
											<p className="text-muted-foreground text-xs">
												Your old username will redirect to your new profile for
												90 days. You can change your username once every 30 days.
											</p>
										)}
									</FormItem>
								)}
							/>
						</div>
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input
											autoComplete="one-time-code"
											data-1p-ignore
											data-bwignore
											data-lpignore="true"
											disabled={!!pendingEmailQuery.data?.pendingEmail}
											placeholder="m@example.com"
											type="email"
											{...field}
										/>
									</FormControl>
									<FormMessage />
									{pendingEmailQuery.data?.pendingEmail && (
										<div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
											<p className="text-amber-800 text-sm dark:text-amber-200">
												A verification email was sent to{" "}
												<strong>
													{pendingEmailQuery.data.pendingEmail}
												</strong>
												. Check your inbox to confirm the change.
											</p>
											<Button
												className="mt-1 h-auto p-0 font-medium text-amber-700 text-sm underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
												disabled={cancelPendingEmail.isPending}
												onClick={() => cancelPendingEmail.mutate()}
												type="button"
												variant="link"
											>
												{cancelPendingEmail.isPending
													? "Cancelling..."
													: "Cancel email change"}
											</Button>
										</div>
									)}
								</FormItem>
							)}
						/>
						{showPasswordField && (
							<FormField
								control={form.control}
								name="currentPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Current Password</FormLabel>
										<FormControl>
											<Input
												placeholder="Required to change email"
												type="password"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
						<div className="flex justify-end">
							<Button
								disabled={!form.formState.isDirty || updateProfile.isPending}
								type="submit"
							>
								{updateProfile.isPending ? "Saving..." : "Save Profile"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
