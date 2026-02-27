"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Camera } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PasswordForm } from "~/components/settings/password-form";
import { TwoFactorSettings } from "~/components/settings/two-factor-settings";

import { Badge } from "~/components/ui/badge";
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
	FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useSession } from "~/hooks/use-session";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const profileSchema = z.object({
	name: z.string().min(1, "Name is required"),
	username: z.string().min(1, "Username is required"),
	email: z.string().email("Invalid email address"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
	role: string;
};

export function ProfileDashboard() {
	const { data: session, isPending, refetch: updateSession } = useSession();
	const { data: appFeatures } = api.auth.getAppFeatures.useQuery();

	const [, setShowDeleteModal] = useState(false);

	const updateProfile = api.profile.update.useMutation({
		onSuccess: async () => {
			toast.success("Profile updated successfully");
			await updateSession();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const form = useForm<ProfileFormValues>({
		resolver: zodResolver(profileSchema),
		values: {
			name: session?.user?.name || "",
			username: (session?.user as ExtendedUser)?.username || "",
			email: session?.user?.email || "",
		},
	});

	if (isPending) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="animate-pulse text-center text-muted-foreground">
						Loading profile...
					</div>
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

	const onSubmit = (values: ProfileFormValues) => {
		updateProfile.mutate(values);
	};

	const initials =
		user.name
			?.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2) || "??";

	const inputClass =
		"bg-secondary/20 border-transparent hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-transparent transition-all";

	return (
		<div className="mx-auto w-full max-w-5xl">
			<div className="grid grid-cols-1 gap-6 items-start xl:grid-cols-2 pb-20">
				{/* Left Column */}
				<div className="space-y-6">
					{/* Profile Header Card */}
					<Card className="relative overflow-hidden border-border/50 shadow-sm">
						<CardContent className="flex items-center gap-4 p-6">
							{/* Avatar */}
							<div className="group relative">
								<div className="relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full border bg-secondary font-bold text-muted-foreground text-lg shadow-sm">
									{user.image ? (
										<Image
											alt={user.name || ""}
											className="h-full w-full object-cover transition-transform group-hover:scale-110"
											height={64}
											src={user.image}
											width={64}
										/>
									) : (
										<span className="transition-transform group-hover:scale-110">
											{initials}
										</span>
									)}
									{/* Hover Overlay */}
									<div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
										<Camera className="h-5 w-5 text-white" />
									</div>
								</div>
							</div>

							{/* Info */}
							<div className="flex-1 space-y-0.5">
								<h2 className="font-bold text-xl text-foreground tracking-tight">
									{user.name || "User Name"}
								</h2>
								<p className="text-muted-foreground text-sm">
									{user.email || "user@example.com"}
								</p>
							</div>
						</CardContent>
					</Card>

					{/* Personal Information Card */}
					<Card className="border-border/50 shadow-sm">
						<CardHeader>
							<CardTitle>Personal Information</CardTitle>
							<CardDescription>
								Update your public profile and contact email.
							</CardDescription>
						</CardHeader>
						<CardContent className="p-6 pt-0">
							<Form {...form}>
								<form
									id="profile-form"
									className="space-y-4"
									onSubmit={form.handleSubmit(onSubmit)}
								>
									<div className="grid grid-cols-2 gap-4">
										<FormField
											control={form.control}
											name="name"
											render={({ field }) => (
												<div className="space-y-2">
													<Label
														className="font-medium text-muted-foreground text-sm"
														htmlFor="name"
													>
														Display Name
													</Label>
													<FormControl>
														<Input
															className={inputClass}
															placeholder="Your name"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</div>
											)}
										/>

										<FormField
											control={form.control}
											name="username"
											render={({ field }) => (
												<div className="space-y-2">
													<Label
														className="font-medium text-muted-foreground text-sm"
														htmlFor="username"
													>
														Username
													</Label>
													<FormControl>
														<div className="relative">
															<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
																@
															</span>
															<Input
																className={cn("pl-7", inputClass)}
																placeholder="username"
																{...field}
															/>
														</div>
													</FormControl>
													<FormMessage />
												</div>
											)}
										/>
									</div>

									<FormField
										control={form.control}
										name="email"
										render={({ field }) => (
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<Label
														className="font-medium text-muted-foreground text-sm"
														htmlFor="email"
													>
														Email Address
													</Label>
													{appFeatures?.isEmailEnabled &&
														!user.emailVerified && (
															<Badge
																variant="outline"
																className="h-5 gap-1 border-warning/20 bg-warning/5 px-2 text-[10px] text-warning uppercase tracking-wider transition-colors hover:bg-warning/10"
															>
																<IconAlertTriangle className="size-3" />
																Unverified
															</Badge>
														)}
												</div>
												<FormControl>
													<Input
														className={inputClass}
														placeholder="email@example.com"
														type="email"
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</div>
										)}
									/>

									<div className="flex justify-end mt-6">
										<Button
											disabled={
												!form.formState.isDirty || updateProfile.isPending
											}
											size="sm"
											type="submit"
										>
											{updateProfile.isPending ? "Saving..." : "Save Changes"}
										</Button>
									</div>
								</form>
							</Form>
						</CardContent>
					</Card>

					{/* Danger Zone Section */}
					{!isAdmin && (
						<div className="flex flex-col items-center justify-between gap-4 border-border/20 border-t pt-8 md:flex-row">
							<p className="text-muted-foreground text-sm">Want to leave?</p>
							<Button
								className="h-9 font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
								onClick={() => setShowDeleteModal(true)}
								variant="ghost"
							>
								Delete Account
							</Button>
						</div>
					)}
				</div>

				{/* Right Column */}
				<div className="space-y-6">
					<PasswordForm />
					<TwoFactorSettings />
				</div>
			</div>
		</div>
	);
}
