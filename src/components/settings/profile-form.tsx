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
			/^[a-z0-9_-]+$/,
			"Username can only contain lowercase letters, numbers, underscores, and hyphens",
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
	const updateProfile = api.profile.update.useMutation({
		onSuccess: () => {
			toast.success("Profile updated");
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
													className="pl-6"
													placeholder="username"
													{...field}
												/>
											</div>
										</FormControl>
										<FormMessage />
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
											placeholder="m@example.com"
											type="email"
											{...field}
										/>
									</FormControl>
									<FormMessage />
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
