"use client";

import { AlertCircle, Check, Copy, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const [showDebug, setShowDebug] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(`${error.message}\n\n${error.stack}`);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

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
				<div className="mt-8 flex w-full max-w-2xl flex-col items-center">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setShowDebug(!showDebug)}
						className="mb-4 text-muted-foreground"
					>
						{showDebug ? "Hide Debug Information" : "Show Debug Information"}
					</Button>
					
					{showDebug && (
						<div className="relative max-h-[50vh] w-full overflow-y-auto rounded-lg border border-border bg-muted p-4 text-left">
							<div className="mb-2 flex items-center justify-between">
								<p className="font-bold font-mono text-destructive text-xs tracking-wide">
									Debug Information:
								</p>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 text-muted-foreground hover:text-foreground"
									onClick={handleCopy}
									title="Copy debug info"
								>
									{copied ? (
										<Check className="h-4 w-4 text-emerald-500" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
							<pre className="whitespace-pre-wrap break-all font-mono text-xs opacity-80">
								{error.message}
								{"\n\n"}
								{error.stack}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
