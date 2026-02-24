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
		<div className="flex flex-col items-center justify-center min-h-[400px] h-full w-full space-y-6 text-center animate-in fade-in duration-500">
			<div className="p-6 rounded-full bg-destructive/10">
				<AlertCircle className="w-12 h-12 text-destructive" />
			</div>

			<div className="space-y-2 px-4">
				<h2 className="text-2xl font-bold tracking-tight text-foreground">
					Something went wrong
				</h2>
				<p className="text-muted-foreground max-w-md mx-auto">
					The dashboard encountered an unexpected rendering error. Your data
					hasn't been affected. Try refreshing the specific section below.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Button
					onClick={() => reset()}
					variant="default"
					className="gap-2 shadow-sm"
				>
					<RotateCcw className="w-4 h-4" />
					Try again
				</Button>

				<Button onClick={() => window.location.reload()} variant="outline">
					Full Reload
				</Button>
			</div>

			{process.env.NODE_ENV === "development" && (
				<div className="mt-8 p-4 rounded-lg bg-muted text-left max-w-2xl overflow-auto border border-border">
					<p className="font-mono text-xs text-destructive mb-2 font-bold uppercase tracking-wider">
						Debug Information:
					</p>
					<pre className="font-mono text-xs whitespace-pre-wrap break-all opacity-80">
						{error.message}
						{"\n\n"}
						{error.stack}
					</pre>
				</div>
			)}
		</div>
	);
}
