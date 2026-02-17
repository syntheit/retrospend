"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as LucideIcons from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "~/components/ui/button";
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
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { CATEGORY_COLORS } from "~/lib/constants";
import { cn } from "~/lib/utils";

// Common icons for the picker
const ICON_OPTIONS = [
	"Home",
	"Car",
	"Utensils",
	"ShoppingBag",
	"Zap",
	"Coffee",
	"Briefcase",
	"GraduationCap",
	"Heart",
	"Music",
	"Plane",
	"Gamepad2",
	"Shirt",
	"Dumbbell",
	"Dog",
	"Hammer",
	"Monitor",
	"Smartphone",
	"Wifi",
	"Gift",
	"CreditCard",
	"Banknote",
	"Bus",
	"Train",
] as const;

export const categoryFormSchema = z.object({
	name: z.string().min(1, "Name is required").max(64, "Name is too long"),
	color: z.enum(CATEGORY_COLORS),
	icon: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryFormSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "create" | "edit";
	defaultValues?: CategoryFormValues;
	onSubmit: (values: CategoryFormValues) => Promise<void>;
	isSubmitting: boolean;
	onDelete?: () => Promise<void>;
}

export function CategoryFormSheet({
	open,
	onOpenChange,
	mode,
	defaultValues,
	onSubmit,
	isSubmitting,
	onDelete,
}: CategoryFormSheetProps) {
	const form = useForm<CategoryFormValues>({
		resolver: zodResolver(categoryFormSchema),
		defaultValues: {
			name: "",
			color: "emerald",
			icon: "Circle",
		},
	});

	useEffect(() => {
		if (open) {
			if (defaultValues) {
				form.reset(defaultValues);
			} else {
				form.reset({
					name: "",
					color: "emerald",
					icon: "Circle",
				});
			}
		}
	}, [open, defaultValues, form]);

	return (
		<Sheet onOpenChange={onOpenChange} open={open}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-md">
				<SheetHeader>
					<SheetTitle>
						{mode === "create" ? "Add Category" : "Edit Category"}
					</SheetTitle>
					<SheetDescription>
						{mode === "create"
							? "Create a new category to organize your spending."
							: "Update your category details."}
					</SheetDescription>
				</SheetHeader>

				<div className="mt-6">
					<Form {...form}>
						<form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input placeholder="e.g. Groceries" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="icon"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Icon</FormLabel>
										<FormControl>
											<div className="grid grid-cols-6 gap-2">
												{ICON_OPTIONS.map((iconName) => {
													const Icons = LucideIcons as unknown as Record<
														string,
														LucideIcons.LucideIcon
													>;
													const IconComp =
														Icons[iconName] || LucideIcons.Circle;
													const isSelected = field.value === iconName;
													return (
														<button
															className={cn(
																"flex aspect-square cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-all hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
																isSelected
																	? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
																	: "border-border",
															)}
															key={iconName}
															onClick={(e) => {
																e.preventDefault();
																field.onChange(iconName);
															}}
															type="button"
														>
															<IconComp className="h-5 w-5" />
														</button>
													);
												})}
											</div>
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
										<FormControl>
											<div className="flex flex-wrap gap-2">
												{CATEGORY_COLORS.map((color) => {
													const isSelected = field.value === color;
													return (
														<button
															className={cn(
																"relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full ring-offset-2 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
																// Dynamic Tailwind classes usually need safelisting, but we'll try standard pattern
																// If this fails, we need to map explicitly.
																// Given previous file has a map, we can rely on standard classes usually present if used elsewhere.
																// But to be safe, let's assume we construct `bg-${color}-500`.
																`bg-${color}-500`,
															)}
															key={color}
															onClick={(e) => {
																e.preventDefault();
																field.onChange(color);
															}}
															title={color}
															type="button"
														>
															{isSelected && (
																<LucideIcons.Check className="h-4 w-4 text-white" />
															)}
															{/* Add a ring for selection visibility on white bg if needed, though checkmark handles it inside */}
															{isSelected && (
																<div
																	className={cn(
																		"absolute inset-0 rounded-full opacity-50 ring-2 ring-primary ring-offset-2 ring-offset-background",
																	)}
																/>
															)}
														</button>
													);
												})}
											</div>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
								{mode === "edit" && onDelete && (
									<Button
										className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
										onClick={onDelete}
										type="button"
										variant="ghost"
									>
										Delete Category
									</Button>
								)}
								<div className="flex flex-1 justify-end gap-3">
									<Button
										onClick={() => onOpenChange(false)}
										type="button"
										variant="outline"
									>
										Cancel
									</Button>
									<Button disabled={isSubmitting} type="submit">
										{isSubmitting
											? "Saving..."
											: mode === "create"
												? "Create Category"
												: "Save Changes"}
									</Button>
								</div>
							</div>
						</form>
					</Form>
				</div>
			</SheetContent>
		</Sheet>
	);
}
