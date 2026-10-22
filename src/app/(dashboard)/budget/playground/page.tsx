"use client";

import { useTranslations } from "next-intl";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { TooltipProvider } from "~/components/ui/tooltip";
import { PlaygroundCanvas } from "./_components/playground-canvas";
import { PlaygroundProvider } from "./_components/playground-context";
import { PlaygroundHeaderActions } from "./_components/playground-header";
import { PlaygroundVisuals } from "./_components/playground-visuals";

export default function BudgetPlaygroundPage() {
	const t = useTranslations("playground");
	const tBudget = useTranslations("budget");
	return (
		<PlaygroundProvider>
			<TooltipProvider>
				<SiteHeader
					title={
						<Breadcrumb>
							<BreadcrumbList>
								<BreadcrumbItem>
									<BreadcrumbLink href="/budget">{tBudget("title")}</BreadcrumbLink>
								</BreadcrumbItem>
								<BreadcrumbSeparator />
								<BreadcrumbItem>
									<BreadcrumbPage>{t("title")}</BreadcrumbPage>
								</BreadcrumbItem>
							</BreadcrumbList>
						</Breadcrumb>
					}
					actions={<PlaygroundHeaderActions />}
				/>
				<PageContent>
					<div className="mx-auto w-full max-w-6xl space-y-8">
						<p className="text-muted-foreground">{t("pageDescription")}</p>
						<PlaygroundVisuals />
						<div className="space-y-4">
							<div>
								<h2 className="font-semibold text-xl tracking-tight">
									{t("simulatorCanvas")}
								</h2>
								<p className="text-muted-foreground text-sm">
									{t("simulatorCanvasDescription")}
								</p>
							</div>
							<PlaygroundCanvas />
						</div>
					</div>
				</PageContent>
			</TooltipProvider>
		</PlaygroundProvider>
	);
}
