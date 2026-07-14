"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import {
	WIDGET_REGISTRY,
	type LayoutItem,
	type WidgetCategory,
} from "../_lib/widget-registry";

interface AddWidgetSheetProps {
	hiddenWidgets: LayoutItem[];
	onAdd: (widgetId: string) => void;
}

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
	overview: "widgets.categories.overview",
	budget: "widgets.categories.budget",
	social: "widgets.categories.social",
	wealth: "widgets.categories.wealth",
	tools: "widgets.categories.tools",
};

const CATEGORY_ORDER: WidgetCategory[] = [
	"overview",
	"budget",
	"social",
	"wealth",
	"tools",
];

export function AddWidgetSheet({ hiddenWidgets, onAdd }: AddWidgetSheetProps) {
	const t = useTranslations("dashboard");
	const [open, setOpen] = useState(false);

	// Group hidden widgets by category
	const grouped = CATEGORY_ORDER.reduce(
		(acc, category) => {
			const widgets = hiddenWidgets.filter(
				(item) => WIDGET_REGISTRY[item.id]?.category === category,
			);
			if (widgets.length > 0) {
				acc.push({ category, widgets });
			}
			return acc;
		},
		[] as Array<{ category: WidgetCategory; widgets: LayoutItem[] }>,
	);

	const allAdded = hiddenWidgets.length === 0;

	return (
		<Sheet onOpenChange={setOpen} open={open}>
			<SheetTrigger asChild>
				<Button className="cursor-pointer" size="sm" variant="outline">
					<Plus className="mr-2 h-4 w-4" />
					{t("widgets.addWidget")}
				</Button>
			</SheetTrigger>
			<SheetContent className="w-[360px] sm:w-[400px]" side="right">
				<SheetHeader>
					<SheetTitle>{t("widgets.addWidget")}</SheetTitle>
					<SheetDescription>
						{allAdded
							? t("widgets.allWidgetsAdded")
							: t("widgets.addWidgetDescription")}
					</SheetDescription>
				</SheetHeader>
				{!allAdded && (
				<div className="mt-2 space-y-4 overflow-y-auto px-4">
					{grouped.map(({ category, widgets }) => (
						<div key={category}>
							<p className="pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
								{t(CATEGORY_LABELS[category])}
							</p>
							<div className="space-y-1">
								{widgets.map((item) => {
									const def = WIDGET_REGISTRY[item.id];
									if (!def) return null;
									const Icon = def.icon;
									return (
										<button
											className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
											key={item.id}
											onClick={() => {
												onAdd(item.id);
												setOpen(false);
											}}
											type="button"
										>
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
												<Icon className="h-4 w-4 text-muted-foreground" />
											</div>
											<div className="min-w-0 flex-1">
												<div className="font-medium text-sm">
													{t(def.name)}
												</div>
												<div className="truncate text-muted-foreground text-xs">
													{t(def.description)}
												</div>
											</div>
											<Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
