import { Github } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export function CtaSection() {
	return (
		<section className="border-y border-border bg-accent/30 py-16 lg:py-24">
			<div className="mx-auto max-w-3xl px-4 text-center">
				<h2 className="font-bold text-3xl tracking-tight">
					Ready to take control of your finances?
				</h2>
				<p className="mx-auto mt-4 max-w-xl text-muted-foreground">
					Start tracking expenses, managing budgets, and building wealth today.
				</p>
				<div className="mt-8 flex items-center justify-center gap-4">
					<Button asChild size="lg">
						<Link href="/signup">Get Started</Link>
					</Button>
					<Button asChild size="lg" variant="outline">
						<Link
							href="https://github.com/syntheit/retrospend"
							target="_blank"
						>
							<Github className="mr-2 h-4 w-4" />
							View on GitHub
						</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}
