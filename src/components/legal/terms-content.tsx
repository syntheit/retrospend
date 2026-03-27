import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";

export function TermsContent() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-bold text-3xl">
					Terms and Conditions
				</CardTitle>
				<CardDescription>Effective Date: March 4, 2026</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6 text-muted-foreground">
				<p>
					By using Retrospend, you agree to these terms. Our data practices are
					described in our{" "}
					<a
						className="text-foreground underline underline-offset-4"
						href="/privacy"
					>
						Privacy Policy
					</a>
					.
				</p>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						1. The Service
					</h2>
					<p>
						Retrospend is an open-source personal financial tracking tool
						licensed under the{" "}
						<a
							className="text-foreground underline underline-offset-4"
							href="https://www.gnu.org/licenses/gpl-3.0.html"
							rel="noopener noreferrer"
							target="_blank"
						>
							GNU GPLv3
						</a>
						, maintained by Daniel Miller (&ldquo;we,&rdquo; &ldquo;us&rdquo;).
						These terms govern your use of the hosted service at retrospend.app.
						If you self-host Retrospend, your use is governed by the license,
						not these terms.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						2. Not Financial Advice
					</h2>
					<p>
						Retrospend is a tracking tool, not a financial advisor. Nothing
						provided through this service constitutes financial, tax, or legal
						advice. We make no warranties about the accuracy or completeness of
						any data or calculations. Consult a qualified professional before
						making financial decisions.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						3. Your Account
					</h2>
					<p>
						You are responsible for your account credentials and all activity
						under your account.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						4. Acceptable Use
					</h2>
					<p className="mb-2">You agree not to:</p>
					<ul className="list-disc space-y-1 pl-6">
						<li>Violate any applicable laws.</li>
						<li>
							Attempt to hack, disrupt, or interfere with the service or its
							infrastructure.
						</li>
						<li>
							Use automated systems to scrape or extract data from the service.
						</li>
					</ul>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						5. Limitation of Liability
					</h2>
					<p>
						To the maximum extent permitted by law, Daniel Miller is not liable
						for any indirect, incidental, special, consequential, or punitive
						damages, including financial losses from tracking errors. The
						service is provided &ldquo;as is&rdquo; and &ldquo;as
						available&rdquo; without warranties of any kind.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						6. Termination
					</h2>
					<p>
						We may suspend or terminate accounts that violate these terms or
						abuse the service. You can delete your account at any time from the
						app settings.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						7. Governing Law
					</h2>
					<p>
						These terms are governed by the laws of the State of Florida, USA.
						Disputes will be resolved in state or federal courts in Clay County,
						Florida.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						8. Changes
					</h2>
					<p>
						We may update these terms. The effective date at the top of this
						page reflects the latest version. Continued use after changes means
						you accept them.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						9. Contact
					</h2>
					<p>
						Questions? Reach us at{" "}
						<a
							className="text-foreground underline underline-offset-4"
							href="mailto:support@retrospend.app"
						>
							support@retrospend.app
						</a>
						.
					</p>
				</section>
			</CardContent>
		</Card>
	);
}
