"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "~/components/ui/button";

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		// Log the error to an error reporting service
		console.error("Dashboard Error:", error);
	}, [error]);

	return (
		<div className="fade-in flex h-full min-h-[400px] w-full animate-in flex-col items-center justify-center space-y-6 text-center duration-500">
			<div className="rounded-full bg-destructive/10 p-6">
				<AlertCircle className="h-12 w-12 text-destructive" />
			</div>

			<div className="space-y-2 px-4">
				<h2 className="font-bold text-2xl text-foreground tracking-tight">
					Something went wrong
				</h2>
				<p className="mx-auto max-w-md text-muted-foreground">
					The dashboard encountered an unexpected rendering error. Your data
					hasn't been affected. Try refreshing the specific section below.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Button
					className="gap-2 shadow-sm"
					onClick={() => reset()}
					variant="default"
				>
					<RotateCcw className="h-4 w-4" />
					Try again
				</Button>

				<Button onClick={() => window.location.reload()} variant="outline">
					Full Reload
				</Button>
			</div>

			{process.env.NODE_ENV === "development" && (
				<div className="mt-8 max-w-2xl overflow-auto rounded-lg border border-border bg-muted p-4 text-left">
					<p className="mb-2 font-bold font-mono text-destructive text-xs uppercase tracking-wider">
						Debug Information:
					</p>
					<pre className="whitespace-pre-wrap break-all font-mono text-xs opacity-80">
						{error.message}
						{"\n\n"}
						{error.stack}
					</pre>
				</div>
			)}
		</div>
	);
}
