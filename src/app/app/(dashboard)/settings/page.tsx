"use client";

import { Github, Globe } from "lucide-react";
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
					<RateSyncControl />

					{/* About Card */}
					<Card>
						<CardContent className="py-4">
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h2 className="text-2xl font-bold tracking-tight">
										Retrospend
									</h2>
									<p className="text-muted-foreground">The Finance Tracker</p>
									<div className="flex gap-3 mt-3">
										<a
											href="https://retrospend.app"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:text-primary/80 transition-colors"
											title="Visit Retrospend website"
										>
											<Globe className="h-5 w-5" />
										</a>
										<a
											href="https://github.com/syntheit/retrospend"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:text-primary/80 transition-colors"
											title="View on GitHub"
										>
											<Github className="h-5 w-5" />
										</a>
									</div>
								</div>
								<div className="sm:text-right space-y-1">
									<p className="text-sm text-muted-foreground">
										Version {APP_VERSION} •{" "}
										<a
											href="https://www.gnu.org/licenses/gpl-3.0.en.html"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline"
										>
											GPL v3
										</a>
									</p>
									<p className="text-sm text-muted-foreground">
										Made by{" "}
										<a
											href="https://matv.io"
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline"
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
