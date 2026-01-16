"use client";

import { Github, Globe } from "lucide-react";
import { BudgetImportExportCard } from "~/components/budget-import-export-card";
import { CsvImportExportCard } from "~/components/csv-import-export-card";
import { PageContent } from "~/components/page-content";
import { RateSyncControl } from "~/components/rate-sync-control";
import { SettingsForm } from "~/components/settings-form";
import { SiteHeader } from "~/components/site-header";
import { Card, CardContent } from "~/components/ui/card";
import { APP_VERSION } from "~/lib/version";

export default function Page() {
	return (
		<>
			<SiteHeader title="Settings" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<SettingsForm />
					<CsvImportExportCard />
					<BudgetImportExportCard />
					<RateSyncControl />

					{/* About Card */}
					<Card>
						<CardContent className="py-4">
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h2 className="font-bold text-2xl tracking-tight">
										Retrospend
									</h2>
									<p className="text-muted-foreground">The Finance Tracker</p>
									<div className="mt-3 flex gap-3">
										<a
											className="text-primary transition-colors hover:text-primary/80"
											href="https://retrospend.app"
											rel="noopener noreferrer"
											target="_blank"
											title="Visit Retrospend website"
										>
											<Globe className="h-5 w-5" />
										</a>
										<a
											className="text-primary transition-colors hover:text-primary/80"
											href="https://github.com/syntheit/retrospend"
											rel="noopener noreferrer"
											target="_blank"
											title="View on GitHub"
										>
											<Github className="h-5 w-5" />
										</a>
									</div>
								</div>
								<div className="space-y-1 sm:text-right">
									<p className="text-muted-foreground text-sm">
										Version {APP_VERSION} •{" "}
										<a
											className="text-primary hover:underline"
											href="https://www.gnu.org/licenses/gpl-3.0.en.html"
											rel="noopener noreferrer"
											target="_blank"
										>
											GPL v3
										</a>
									</p>
									<p className="text-muted-foreground text-sm">
										Made by{" "}
										<a
											className="text-primary hover:underline"
											href="https://matv.io"
											rel="noopener noreferrer"
											target="_blank"
										>
											Daniel Miller
										</a>
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</PageContent>
		</>
	);
}
