"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
	defaultExpenseDateBehavior: z.enum(["TODAY", "LAST_USED"]),
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
			defaultExpenseDateBehavior: "TODAY",
		},
	});

	useEffect(() => {
		if (settings) {
			form.reset({
				categoryClickBehavior: settings.categoryClickBehavior || "toggle",
				currencySymbolStyle: settings.currencySymbolStyle || "standard",
				defaultExpenseDateBehavior: settings.defaultExpenseDateBehavior || "TODAY",
			});
		}
	}, [settings, form]);

	const utils = api.useUtils();

	const onSubmit = useCallback(
		async (values: InteractionValues) => {
			if (!settings) return;

			try {
				await updateSettingsMutation.mutateAsync({
					categoryClickBehavior: values.categoryClickBehavior,
					currencySymbolStyle: values.currencySymbolStyle,
					defaultExpenseDateBehavior: values.defaultExpenseDateBehavior,
					homeCurrency: settings.homeCurrency || "USD",
					defaultCurrency: settings.defaultCurrency || "USD",
					monthlyIncome: settings.monthlyIncome
						? Number(settings.monthlyIncome)
						: undefined,
					smartCurrencyFormatting: settings.smartCurrencyFormatting ?? true,
				});
				await utils.settings.getGeneral.invalidate();
				form.reset(values);
				toast.success("Interaction settings updated");
			} catch (err) {
				const errMsg =
					err instanceof Error ? err.message : "Failed to save settings";
				toast.error(errMsg);
			}
		},
		[settings, updateSettingsMutation, form, utils],
	);

	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;

	const save = useCallback(() => {
		void form.handleSubmit(onSubmitRef.current)();
	}, [form]); // form is stable; onSubmit accessed via ref

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
										onValueChange={(value) => {
											field.onChange(value);
											save();
										}}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select behavior" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="navigate">
												Navigate to Transactions
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
										onValueChange={(value) => {
											field.onChange(value);
											save();
										}}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
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

						<FormField
							control={form.control}
							name="defaultExpenseDateBehavior"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Default Expense Date</FormLabel>
									<Select
										defaultValue={field.value}
										onValueChange={(value) => {
											field.onChange(value);
											save();
										}}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select behavior" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="TODAY">Today</SelectItem>
											<SelectItem value="LAST_USED">
												Last Used Date
											</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Date pre-filled when creating a new expense.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
