"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
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
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/components/ui/form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";

const interactionSchema = z.object({
	categoryClickBehavior: z.enum(["navigate", "toggle"]),
	currencySymbolStyle: z.enum(["native", "standard"]),
});

type InteractionValues = z.infer<typeof interactionSchema>;

export function InteractionCard() {
	const { data: settings, isLoading: settingsLoading } =
		api.settings.getGeneral.useQuery();

	const updateSettingsMutation = api.settings.updateGeneral.useMutation();

	const form = useForm<InteractionValues>({
		resolver: zodResolver(interactionSchema),
		defaultValues: {
			categoryClickBehavior: "toggle",
			currencySymbolStyle: "standard",
		},
	});

	useEffect(() => {
		if (settings) {
			form.reset({
				categoryClickBehavior: settings.categoryClickBehavior || "toggle",
				currencySymbolStyle: settings.currencySymbolStyle || "standard",
			});
		}
	}, [settings, form]);

	const onSubmit = async (values: InteractionValues) => {
		if (!settings) return;

		try {
			await updateSettingsMutation.mutateAsync({
				categoryClickBehavior: values.categoryClickBehavior,
				currencySymbolStyle: values.currencySymbolStyle,
				homeCurrency: settings.homeCurrency || "USD",
				defaultCurrency: settings.defaultCurrency || "USD",
				fontPreference: settings.fontPreference || "sans",
				monthlyIncome: settings.monthlyIncome
					? Number(settings.monthlyIncome)
					: undefined,
				smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
			});
			form.reset(values);
			toast.success("Interaction settings saved!");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save settings";
			toast.error(errMsg);
		}
	};

	const inputClass =
		"bg-secondary/20 border-transparent hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-transparent transition-all";

	if (settingsLoading) {
		return (
			<Card className="w-full">
				<CardContent className="p-6">
					<div className="text-center text-muted-foreground">Loading...</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>Interaction</CardTitle>
				<CardDescription>
					Behavior adjustments for easier navigation.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
						<FormField
							control={form.control}
							name="categoryClickBehavior"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Category Click Behavior</FormLabel>
									<Select
										defaultValue={field.value}
										onValueChange={field.onChange}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger className={inputClass}>
												<SelectValue placeholder="Select behavior" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="navigate">
												Navigate to Table View
											</SelectItem>
											<SelectItem value="toggle">
												Toggle Category Visibility
											</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Action when clicking a category on charts.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="currencySymbolStyle"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Currency Symbol Style</FormLabel>
									<Select
										defaultValue={field.value}
										onValueChange={field.onChange}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger className={inputClass}>
												<SelectValue placeholder="Select style" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="standard">
												Standard (AR$, CA$, €)
											</SelectItem>
											<SelectItem value="native">Native ($, $, €)</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Display format for foreign currencies.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex justify-end pt-2">
							<Button
								disabled={
									!form.formState.isDirty || updateSettingsMutation.isPending
								}
								type="submit"
							>
								{updateSettingsMutation.isPending
									? "Saving..."
									: "Save Changes"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
