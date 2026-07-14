import { Github, Hash, Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function LandingFooter({ showLegalLinks }: { showLegalLinks: boolean }) {
	const t = useTranslations("landing");

	return (
		<footer className="border-border border-t bg-background py-12">
			<div className="mx-auto max-w-6xl px-4 text-center">
				<div className="mb-3 flex items-center justify-center gap-4">
					<Link
						aria-label={t("viewOnGitHub")}
						className="inline-block text-muted-foreground transition-colors hover:text-foreground"
						href="https://github.com/syntheit/retrospend"
						target="_blank"
						title={t("viewOnGitHub")}
					>
						<Github className="h-6 w-6" />
					</Link>
					<Link
						aria-label={t("joinMatrix")}
						className="inline-block text-muted-foreground transition-colors hover:text-[#0DBD8B]"
						href="https://matrix.to/#/#retrospend:matrix.org"
						target="_blank"
						title={t("joinMatrix")}
					>
						<Hash className="h-6 w-6" />
					</Link>
					<Link
						aria-label={t("supportRetrospend")}
						className="inline-block text-muted-foreground transition-colors hover:text-rose-500"
						href="https://retrospend.app/u/daniel?donate"
						target="_blank"
						title={t("supportRetrospend")}
					>
						<Heart className="h-6 w-6" />
					</Link>
				</div>
				<p className="text-muted-foreground text-sm">
					{t("madeBy")}{" "}
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
							{t("termsAndConditions")}
						</Link>
						<Link
							className="underline underline-offset-4 transition-colors hover:text-foreground"
							href="/privacy"
						>
							{t("privacyPolicy")}
						</Link>
					</div>
				)}
			</div>
		</footer>
	);
}
