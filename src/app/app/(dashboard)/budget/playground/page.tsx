"use client";

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
import { PlaygroundHeader } from "./_components/playground-header";
import { PlaygroundVisuals } from "./_components/playground-visuals";

export default function BudgetPlaygroundPage() {
	return (
		<PlaygroundProvider>
			<TooltipProvider>
				<SiteHeader
					title={
						<Breadcrumb>
							<BreadcrumbList>
								<BreadcrumbItem>
									<BreadcrumbLink href="/app/budget">Budget</BreadcrumbLink>
								</BreadcrumbItem>
								<BreadcrumbSeparator />
								<BreadcrumbItem>
									<BreadcrumbPage>Playground</BreadcrumbPage>
								</BreadcrumbItem>
							</BreadcrumbList>
						</Breadcrumb>
					}
				/>
				<PageContent>
					<div className="mx-auto w-full max-w-6xl space-y-8">
						<PlaygroundHeader />
						<PlaygroundVisuals />
						<div className="space-y-4">
							<div>
								<h2 className="font-semibold text-xl tracking-tight">
									Simulator Canvas
								</h2>
								<p className="text-muted-foreground text-sm">
									Adjust the sliders or type in amounts to see how your
									financial outlook changes.
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
