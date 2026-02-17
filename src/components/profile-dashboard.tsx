"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PasswordForm } from "~/components/settings/password-form";
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
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
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
	const { data: stats, isLoading: statsLoading } =
		api.profile.getLifetimeStats.useQuery();
	const { formatCurrency } = useCurrencyFormatter();
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
		<div className="mx-auto mt-4 w-full max-w-4xl space-y-8 pb-20">
			{/* Passport Card (Identity + Stats) */}
			<Card className="mb-8 w-full overflow-hidden border-border/50 bg-card py-0 shadow-sm">
				{/* Section A: The Banner */}
				<div className="h-12 w-full bg-gradient-to-r from-primary/20 via-purple-500/10 to-transparent" />

				{/* Section B: The Identity */}
				<div className="px-6 pt-6 pb-6">
					<div className="flex flex-col gap-6 md:flex-row md:items-end">
						{/* Avatar */}
						<div className="group relative -mt-16">
							<div className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-4 border-card bg-gradient-to-br from-blue-600 to-violet-600 font-bold text-white text-xl shadow-lg">
								{user.image ? (
									<Image
										alt={user.name || ""}
										className="h-full w-full object-cover transition-transform group-hover:scale-110"
										height={80}
										src={user.image}
										width={80}
									/>
								) : (
									<span className="transition-transform group-hover:scale-110">
										{initials}
									</span>
								)}
								{/* Hover Overlay */}
								<div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
									<Camera className="h-6 w-6 text-white" />
								</div>
							</div>
						</div>

						{/* Info */}
						<div className="flex-1 space-y-1 py-1">
							<div className="flex items-center gap-3">
								<h2 className="font-bold text-2xl text-foreground tracking-tight">
									{user.name || "User Name"}
								</h2>
							</div>
							<p className="text-muted-foreground">
								{user.email || "user@example.com"}
							</p>
						</div>
					</div>
				</div>

				{/* Section C: The Stats Footer */}
				<div className="grid grid-cols-3 border-border/50 border-t bg-secondary/5">
					<div className="flex flex-col items-center justify-center border-border/50 border-r py-4">
						<span className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
							VOLUME
						</span>
						<span className="font-bold font-mono text-xl tabular-nums">
							{statsLoading
								? "..."
								: formatCurrency(
										stats?.lifetimeSpend ?? 0,
										stats?.homeCurrency ?? "USD",
									)}
						</span>
					</div>
					<div className="flex flex-col items-center justify-center border-border/50 border-r py-4">
						<span className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
							ENTRIES
						</span>
						<span className="font-bold font-mono text-xl tabular-nums">
							{statsLoading
								? "..."
								: (stats?.totalEntries ?? 0).toLocaleString()}
						</span>
					</div>
					<div className="flex flex-col items-center justify-center py-4">
						<span className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
							USER SINCE
						</span>
						<span className="font-bold font-mono text-xl tabular-nums">
							{statsLoading
								? "..."
								: new Intl.DateTimeFormat("en-US", {
										month: "short",
										year: "numeric",
									}).format(new Date(stats?.joinedAt ?? Date.now()))}
						</span>
					</div>
				</div>
			</Card>

			<div className="space-y-6">
				<Card className="border-border/50 shadow-sm">
					<CardHeader>
						<CardTitle>Personal Information</CardTitle>
						<CardDescription>
							Update your public profile and contact email.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Form {...form}>
							<form
								className="space-y-4"
								onSubmit={form.handleSubmit(onSubmit)}
							>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
											<Label
												className="font-medium text-muted-foreground text-sm"
												htmlFor="email"
											>
												Email Address
											</Label>
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

								<div className="flex justify-end pt-2">
									<Button
										disabled={
											!form.formState.isDirty || updateProfile.isPending
										}
										type="submit"
									>
										{updateProfile.isPending ? "Saving..." : "Save Changes"}
									</Button>
								</div>
							</form>
						</Form>
					</CardContent>
				</Card>

				<PasswordForm />

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
		</div>
	);
}
