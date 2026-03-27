import { BookOpen, Github } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export function CtaSection() {
	return (
		<section className="border-border border-y bg-accent/30 py-16 lg:py-24">
			<div className="mx-auto max-w-3xl px-4 text-center">
				<h2 className="font-bold text-3xl tracking-tight">
					One app. Everything financial.
				</h2>
				<p className="mx-auto mt-4 max-w-xl text-muted-foreground">
					Track spending, split bills, manage budgets, and watch your net worth grow.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Button asChild size="lg">
						<Link href="/signup">Get Started</Link>
					</Button>
					<Button asChild size="lg" variant="outline">
						<Link href="/docs?from=site">
							<BookOpen className="mr-2 h-4 w-4" />
							Documentation
						</Link>
					</Button>
					<Button asChild size="lg" variant="outline">
						<Link href="https://github.com/syntheit/retrospend" target="_blank">
							<Github className="mr-2 h-4 w-4" />
							View on GitHub
						</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}
