"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { useSession } from "~/hooks/use-session";

export function HeroSection() {
	const { data: session, isPending } = useSession();
	const isLoggedIn = !isPending && !!session?.user;

	return (
		<section className="py-24 lg:py-32">
			<div className="relative mx-auto max-w-3xl text-center">
				<div className="pointer-events-none absolute -top-16 left-1/2 h-64 w-96 -translate-x-2/3 rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
				<div className="pointer-events-none absolute -top-8 left-1/2 h-48 w-72 -translate-x-1/3 rounded-full bg-chart-2/15 blur-3xl" aria-hidden="true" />
				<h1 className="font-bold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
					The Financial Multitool
				</h1>
				<p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground leading-8">
					Expenses, budgets, and wealth tracking. Without the bloat.
				</p>
				{!isPending && (
					<div className="mt-10 flex items-center justify-center gap-4">
						{isLoggedIn ? (
							<Button asChild size="lg">
								<Link href="/app">Go to Dashboard</Link>
							</Button>
						) : (
							<>
								<Button asChild size="lg">
									<Link href="/signup">Get Started</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="/login">Login</Link>
								</Button>
							</>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
