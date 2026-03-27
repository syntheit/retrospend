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
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -top-16 left-1/2 h-64 w-96 -translate-x-2/3 rounded-full bg-primary/20 blur-3xl"
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -top-8 left-1/2 h-48 w-72 -translate-x-1/3 rounded-full bg-chart-2/15 blur-3xl"
				/>
				<h1 className="font-bold text-5xl tracking-tight sm:text-6xl lg:text-7xl">
					Retrospend
				</h1>
				<p className="mt-4 text-lg text-muted-foreground sm:text-xl">
					The Financial Multitool
				</p>
				<p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground/70 leading-7">
					Expenses, budgets, wealth tracking, and bill splitting. Without the bloat.
				</p>
				{!isPending && (
					<div className="mt-10 flex items-center justify-center gap-4">
						{isLoggedIn ? (
							<Button asChild size="lg">
								<Link href="/dashboard">Go to Dashboard</Link>
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
