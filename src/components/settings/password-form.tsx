"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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

const passwordSchema = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

type PasswordFormValues = z.infer<typeof passwordSchema>;

export function PasswordForm() {
	const changePassword = api.profile.changePassword.useMutation({
		onSuccess: () => {
			toast.success("Password updated successfully");
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
		},
	});

	const onSubmit = (values: PasswordFormValues) => {
		changePassword.mutate({
			currentPassword: values.currentPassword,
			newPassword: values.newPassword,
			confirmPassword: values.newPassword, // Bypassing confirm password requirement in API if any
		});
	};

	const inputClass =
		"bg-secondary/20 border-transparent hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-transparent transition-all";

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>Security</CardTitle>
				<CardDescription>
					Update your password to keep your account secure.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="currentPassword"
								render={({ field }) => (
									<FormItem className="space-y-2">
										<FormLabel className="font-medium text-muted-foreground text-sm">
											Current Password
										</FormLabel>
										<FormControl>
											<Input
												className={inputClass}
												placeholder="••••••••"
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
								name="newPassword"
								render={({ field }) => (
									<FormItem className="space-y-2">
										<FormLabel className="font-medium text-muted-foreground text-sm">
											New Password
										</FormLabel>
										<FormControl>
											<Input
												className={inputClass}
												placeholder="Enter new password"
												type="password"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<div className="flex justify-end pt-2">
							<Button
								disabled={!form.formState.isDirty || changePassword.isPending}
								type="submit"
							>
								{changePassword.isPending ? "Saving..." : "Save Password"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
