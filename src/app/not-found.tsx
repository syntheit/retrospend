import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export const metadata: Metadata = {
	title: "Page Not Found",
};

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
			<div className="flex flex-col items-center gap-6">
				<h1 className="font-bold text-7xl text-primary tracking-tight">
					404
				</h1>
				<div className="space-y-1">
					<h2 className="font-semibold text-xl text-foreground">
						Page not found
					</h2>
					<p className="text-muted-foreground">
						The page you're looking for doesn't exist.
					</p>
				</div>
				<Button asChild className="select-none">
					<Link href="/dashboard">Go to dashboard</Link>
				</Button>
			</div>
		</div>
	);
}
