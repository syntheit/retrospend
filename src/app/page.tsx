import { Github } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "~/components/ui/button";
import { env } from "~/env";

export const dynamic = "force-dynamic";

export default function RootPage() {
	const showLandingPage = env.SHOW_LANDING_PAGE === "true";

	if (!showLandingPage) {
		redirect("/app");
	}

	return (
		<div className="flex min-h-screen flex-col justify-between bg-stone-50 dark:bg-stone-950">
			<div className="flex flex-1 items-center justify-center">
				<div className="container mx-auto px-4 text-center">
					<div className="mx-auto max-w-2xl">
						<h1 className="font-bold text-4xl text-stone-900 tracking-tight sm:text-6xl dark:text-stone-50">
							Retrospend
						</h1>
						<p className="mt-6 text-lg text-stone-600 leading-8 dark:text-stone-400">
							The Finance Tracker
						</p>
						<div className="mt-10">
							<Button asChild size="lg">
								<Link href="/app">Login / Go to App</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
			<footer className="pb-8 text-center">
				<div className="mb-2">
					<Link
						href="https://github.com/syntheit/retrospend"
						target="_blank"
						className="inline-block text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
					>
						<Github className="h-6 w-6" />
					</Link>
				</div>
				<p className="text-sm text-stone-500 dark:text-stone-400">
					Made by{" "}
					<Link
						className="text-stone-600 underline underline-offset-4 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
						href="https://matv.io"
						target="_blank"
					>
						Daniel Miller
					</Link>
				</p>
			</footer>
		</div>
	);
}
