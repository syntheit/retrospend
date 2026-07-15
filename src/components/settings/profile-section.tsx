"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AvatarUploadCard } from "~/components/settings/avatar-upload-card";
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
import { useEffect, useState } from "react";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	username: string;
	role: string;
};

export function ProfileSection() {
	const t = useTranslations("settingsPage");
	const { data: session, isPending, refetch: updateSession } = useSession();

	const profileSchema = z.object({
		name: z.string().min(1, t("nameRequired")),
		username: z.string().min(1, t("usernameRequired")),
		email: z.string().email(t("invalidEmail")),
		currentPassword: z.string().optional(),
	});

	type ProfileFormValues = z.infer<typeof profileSchema>;
	const { data: appFeatures } = api.auth.getAppFeatures.useQuery();
	const utils = api.useUtils();

	const pendingEmailQuery = api.profile.getPendingEmail.useQuery();
	const cancelPendingEmail = api.profile.cancelPendingEmailChange.useMutation({
		onSuccess: () => {
			toast.success(t("pendingEmailCancelled"));
			void utils.profile.getPendingEmail.invalidate();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const updateProfile = api.profile.update.useMutation({
		onSuccess: async (data) => {
			if ("emailChangePending" in data && data.emailChangePending) {
				toast.success(
					t("verificationEmailSent"),
				);
				void utils.profile.getPendingEmail.invalidate();
			} else {
				toast.success(t("profileUpdatedSuccessfully"));
			}
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
			currentPassword: "",
		},
	});

	const watchedEmail = form.watch("email");
	const emailChanged = watchedEmail !== (session?.user?.email || "");
	const [showPasswordField, setShowPasswordField] = useState(false);

	useEffect(() => {
		setShowPasswordField(emailChanged);
		if (!emailChanged) {
			form.setValue("currentPassword", "");
		}
	}, [emailChanged, form]);

	if (isPending) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="animate-pulse text-center text-muted-foreground">
						{t("loadingProfile")}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) return null;

	const user = session.user as ExtendedUser;

	const onSubmit = (values: ProfileFormValues) => {
		updateProfile.mutate(values);
	};

	return (
		<div className="space-y-6">
			<AvatarUploadCard />

			<Card className="border-border/50 shadow-sm">
				<CardHeader>
					<CardTitle>{t("personalInformation")}</CardTitle>
					<CardDescription>
						{t("personalInformationDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Form {...form}>
						<form
							className="space-y-4"
							id="profile-form"
							onSubmit={form.handleSubmit(onSubmit)}
						>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<div className="space-y-2">
											<Label
												className="font-medium text-muted-foreground text-sm"
												htmlFor="name"
											>
												{t("displayName")}
											</Label>
											<FormControl>
												<Input
													placeholder={t("yourName")}
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
												{t("username")}
											</Label>
											<FormControl>
												<div className="relative">
													<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
														@
													</span>
													<Input
														className="pl-7"
														placeholder={t("usernamePlaceholder")}
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
												{t("emailAddress")}
											</Label>
											{appFeatures?.isEmailEnabled &&
												!user.emailVerified && (
													<Badge
														className="h-5 gap-1 border-warning/20 bg-warning/5 px-2 text-[10px] text-warning tracking-wide transition-colors hover:bg-warning/10"
														variant="outline"
													>
														<AlertTriangle className="size-3" />
														{t("unverified")}
													</Badge>
												)}
										</div>
										<FormControl>
											<Input
												disabled={!!pendingEmailQuery.data?.pendingEmail}
												placeholder="email@example.com"
												type="email"
												{...field}
											/>
										</FormControl>
										<FormMessage />
										{pendingEmailQuery.data?.pendingEmail && (
											<div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
												<p className="text-amber-800 text-sm dark:text-amber-200">
													{t("pendingVerificationEmail", { email: pendingEmailQuery.data.pendingEmail })}
												</p>
												<Button
													className="mt-1 h-auto p-0 font-medium text-amber-700 text-sm underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
													disabled={cancelPendingEmail.isPending}
													onClick={() => cancelPendingEmail.mutate()}
													type="button"
													variant="link"
												>
													{cancelPendingEmail.isPending
														? t("cancelling")
														: t("cancelEmailChange")}
												</Button>
											</div>
										)}
									</div>
								)}
							/>

							{showPasswordField && (
								<FormField
									control={form.control}
									name="currentPassword"
									render={({ field }) => (
										<div className="space-y-2">
											<Label
												className="font-medium text-muted-foreground text-sm"
												htmlFor="currentPassword"
											>
												{t("currentPassword")}
											</Label>
											<FormControl>
												<Input
													placeholder={t("requiredToChangeEmail")}
													type="password"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</div>
									)}
								/>
							)}

							<div className="mt-6 flex justify-end">
								<Button
									disabled={
										!form.formState.isDirty || updateProfile.isPending
									}
									size="sm"
									type="submit"
								>
									{updateProfile.isPending ? t("saving") : t("saveChanges")}
								</Button>
							</div>
						</form>
					</Form>
				</CardContent>
			</Card>

			</div>
	);
}
