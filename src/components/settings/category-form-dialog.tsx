import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { CATEGORY_COLOR_MAP, CATEGORY_COLORS } from "~/lib/constants";
import { cn } from "~/lib/utils";

const categoryFormSchema = z.object({
	name: z.string().min(1, "Category name is required"),
	color: z.enum(CATEGORY_COLORS, {
		message: "Category color is invalid",
	}),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultValues?: CategoryFormValues;
	onSubmit: (values: CategoryFormValues) => Promise<void>;
	isSubmitting?: boolean;
	mode: "create" | "edit";
}

export function CategoryFormDialog({
	open,
	onOpenChange,
	defaultValues,
	onSubmit,
	isSubmitting = false,
	mode,
}: CategoryFormDialogProps) {
	const form = useForm<CategoryFormValues>({
		resolver: zodResolver(categoryFormSchema),
		defaultValues: {
			name: "",
			color: "blue",
		},
	});

	// Reset form when dialog opens/closes or defaultValues change
	useEffect(() => {
		if (open) {
			form.reset(
				defaultValues ?? {
					name: "",
					color: "blue",
				},
			);
		}
	}, [open, defaultValues, form]);

	const handleSubmit = async (values: CategoryFormValues) => {
		await onSubmit(values);
		// Don't close dialog here, let parent handle it on success or let it stay open on error
		// But usually we want to clear the form if we are reusing it.
		// logic moved to parent or useEffect above resets it on open.
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{mode === "edit" ? "Edit Category" : "Add Category"}
					</DialogTitle>
					<DialogDescription>
						{mode === "edit"
							? "Update the category name and color."
							: "Create a new category to organize your expenses."}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form
						className="space-y-4"
						onSubmit={form.handleSubmit(handleSubmit)}
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Category Name</FormLabel>
									<FormControl>
										<Input
											placeholder="e.g., Groceries, Transport, Dining"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="color"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Color</FormLabel>
									<Select
										defaultValue={field.value}
										onValueChange={field.onChange}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{CATEGORY_COLORS.map((color) => (
												<SelectItem key={color} value={color}>
													<div className="flex items-center gap-2">
														<div
															className={cn(
																"h-3 w-3 rounded-full",
																CATEGORY_COLOR_MAP[color]?.split(" ")[0] ||
																	"bg-gray-400",
															)}
														/>
														<span className="capitalize">{color}</span>
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						<DialogFooter>
							<Button
								disabled={isSubmitting}
								onClick={() => onOpenChange(false)}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button disabled={isSubmitting} type="submit">
								{isSubmitting
									? "Saving..."
									: mode === "edit"
										? "Update Category"
										: "Add Category"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
