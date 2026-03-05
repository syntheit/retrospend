import { Github } from "lucide-react";
import Link from "next/link";

export function LandingFooter({
	showLegalLinks,
}: { showLegalLinks: boolean }) {
	return (
		<footer className="border-t border-border bg-background py-12">
			<div className="mx-auto max-w-6xl px-4 text-center">
				<div className="mb-3">
					<Link
						className="inline-block text-muted-foreground transition-colors hover:text-foreground"
						href="https://github.com/syntheit/retrospend"
						target="_blank"
					>
						<Github className="h-6 w-6" />
					</Link>
				</div>
				<p className="text-muted-foreground text-sm">
					Made by{" "}
					<Link
						className="text-foreground/80 underline underline-offset-4 hover:text-foreground"
						href="https://matv.io"
						target="_blank"
					>
						Daniel Miller
					</Link>
				</p>
				{showLegalLinks && (
					<div className="mt-4 flex items-center justify-center gap-4 text-muted-foreground text-sm">
						<Link
							className="underline underline-offset-4 transition-colors hover:text-foreground"
							href="/terms"
						>
							Terms & Conditions
						</Link>
						<Link
							className="underline underline-offset-4 transition-colors hover:text-foreground"
							href="/privacy"
						>
							Privacy Policy
						</Link>
					</div>
				)}
			</div>
		</footer>
	);
}
