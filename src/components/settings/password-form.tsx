"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { api } from "~/trpc/react";

export function PasswordForm() {
	const t = useTranslations("settingsPage");

	const passwordSchema = z
		.object({
			currentPassword: z.string().min(1, t("currentPasswordRequired")),
			newPassword: z
				.string()
				.min(8, t("passwordMinLength"))
				.max(255)
				.regex(
					/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
					t("passwordComplexity"),
				),
			confirmPassword: z.string().min(1, t("pleaseConfirmPassword")),
		})
		.refine((data) => data.newPassword === data.confirmPassword, {
			message: t("passwordsDoNotMatch"),
			path: ["confirmPassword"],
		});

	type PasswordFormValues = z.infer<typeof passwordSchema>;

	const changePassword = api.profile.changePassword.useMutation({
		onSuccess: () => {
			toast.success(t("passwordUpdated"));
			form.reset();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const form = useForm<PasswordFormValues>({
		resolver: zodResolver(passwordSchema),
		defaultValues: {
			currentPassword: "",
			newPassword: "",
			confirmPassword: "",
		},
	});

	const onSubmit = (values: PasswordFormValues) => {
		changePassword.mutate({
			currentPassword: values.currentPassword,
			newPassword: values.newPassword,
			confirmPassword: values.confirmPassword,
		});
	};

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>{t("changePassword")}</CardTitle>
				<CardDescription>
					{t("changePasswordDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form
						className="space-y-4"
						id="password-form"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						<FormField
							control={form.control}
							name="currentPassword"
							render={({ field }) => (
								<FormItem className="space-y-2">
									<FormLabel className="font-medium text-muted-foreground text-sm">
										{t("currentPassword")}
									</FormLabel>
									<FormControl>
										<Input placeholder="••••••••" type="password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="newPassword"
							render={({ field }) => (
								<FormItem className="space-y-2">
									<FormLabel className="font-medium text-muted-foreground text-sm">
										{t("newPassword")}
									</FormLabel>
									<FormControl>
										<Input
											placeholder={t("enterNewPassword")}
											type="password"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem className="space-y-2">
									<FormLabel className="font-medium text-muted-foreground text-sm">
										{t("confirmNewPassword")}
									</FormLabel>
									<FormControl>
										<Input
											placeholder={t("confirmNewPasswordPlaceholder")}
											type="password"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="mt-6 flex justify-end">
							<Button
								disabled={!form.formState.isDirty || changePassword.isPending}
								size="sm"
								type="submit"
							>
								{changePassword.isPending ? t("saving") : t("savePassword")}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
