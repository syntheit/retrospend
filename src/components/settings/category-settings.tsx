"use client";

import { ChevronRight, Settings2 } from "lucide-react";
import { useState } from "react";
import { CategoryManagerDialog } from "~/components/settings/category-manager-dialog";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function CategorySettings() {
	const [isManagerOpen, setIsManagerOpen] = useState(false);

	const { data: categories, isLoading: categoriesLoading } =
		api.categories.getAll.useQuery();

	const previewCategories = categories?.slice(0, 5) ?? [];

	return (
		<>
			<Card className="group relative overflow-hidden border-border/50 shadow-sm transition-all hover:border-primary/20">
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-primary/5 opacity-0 transition-opacity group-hover:opacity-100"
				/>
				<CardHeader className="flex flex-row items-start justify-between pb-2">
					<div className="flex flex-col gap-1">
						<CardTitle className="flex items-center gap-2 font-semibold text-lg">
							<Settings2 className="h-4 w-4 text-muted-foreground" />
							Categories
						</CardTitle>
						<CardDescription className="text-sm">
							Manage your expense labels and icons.
						</CardDescription>
					</div>
					<Button
						className="z-10 h-8 gap-1.5 font-medium text-xs"
						onClick={() => setIsManagerOpen(true)}
						size="sm"
						variant="secondary"
					>
						Manage
						<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
					</Button>
				</CardHeader>
				<CardContent>
					<div className="flex items-center pt-2">
						{categoriesLoading ? (
							<div className="flex -space-x-3">
								{[1, 2, 3].map((i) => (
									<div
										className="h-9 w-9 animate-pulse rounded-full bg-muted ring-2 ring-background"
										key={i}
									/>
								))}
							</div>
						) : (
							<div className="-ml-1 flex items-center -space-x-3 p-1 transition-all duration-300 ease-out group-hover:space-x-1">
								{previewCategories.map((category) => {
									const Icon = getCategoryIcon(
										category.name,
										category.icon,
									);
									return (
										<div
											className={cn(
												"relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background shadow-sm ring-1 ring-border/50 transition-all hover:z-10 hover:scale-110",
												getCategoryColorClasses(category.color, "light"),
											)}
											key={category.id}
											title={category.name}
										>
											<Icon className="h-4 w-4" />
										</div>
									);
								})}
								{categories && categories.length > 5 && (
									<div className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted font-bold text-[10px] text-muted-foreground ring-1 ring-border/50">
										+{categories.length - 5}
									</div>
								)}
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			<CategoryManagerDialog
				open={isManagerOpen}
				onOpenChange={setIsManagerOpen}
			/>
		</>
	);
}
