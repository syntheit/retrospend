import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";

export function PrivacyContent() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-bold text-3xl">Privacy Policy</CardTitle>
				<CardDescription>Effective Date: March 4, 2026</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6 text-muted-foreground">
				<p>
					This policy explains how Daniel Miller (&ldquo;we,&rdquo;
					&ldquo;us&rdquo;) collects, uses, and protects your information when
					you use Retrospend.
				</p>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						1. What We Collect
					</h2>
					<ul className="list-disc space-y-1 pl-6">
						<li>
							<strong>Account information:</strong> Your email address and basic
							profile information, used for login and service notifications.
						</li>
						<li>
							<strong>Financial data:</strong> Transactions, budgets, and
							categories you enter into the app, stored so you can access them
							across devices.
						</li>
					</ul>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						2. No Tracking
					</h2>
					<p>
						We do not track you. No third-party analytics, no tracking cookies,
						no ad pixels. The only cookies we use are session tokens required to
						keep you logged in.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						3. How We Use and Store Your Data
					</h2>
					<p className="mb-2">
						We process your data to provide the service you signed up for. All
						data is hosted on servers in the United States. When you delete your
						account, all your data is permanently removed immediately.
					</p>
					<p>
						We will never sell your personal information or financial data to
						anyone.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						4. Third-Party Providers
					</h2>
					<p className="mb-2">
						We use infrastructure providers to run the service (hosting, email
						delivery). These providers process data on our behalf and are
						contractually prohibited from using it for their own purposes.
					</p>
					<p>
						If you opt in to external processing for bank statement imports,
						transaction data is sent to a third-party LLM provider. Identifying
						information is stripped before transmission. This feature is off by
						default and requires your explicit consent.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						5. Open Source
					</h2>
					<p>
						Retrospend is open-source software. You can review exactly how your
						data is handled by inspecting the{" "}
						<a
							className="text-foreground underline underline-offset-4"
							href="https://github.com/syntheit/retrospend"
							rel="noopener noreferrer"
							target="_blank"
						>
							source code
						</a>
						.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						6. Your Rights
					</h2>
					<p className="mb-2">You can, at any time:</p>
					<ul className="list-disc space-y-1 pl-6">
						<li>
							<strong>Access</strong> all data Retrospend holds about you within
							the app.
						</li>
						<li>
							<strong>Export</strong> your financial data in CSV format using
							the built-in export feature.
						</li>
						<li>
							<strong>Delete</strong> your account and all associated data
							permanently from the app settings.
						</li>
					</ul>
					<p className="mt-2">
						If you are in the EU, you also have the right to lodge a complaint
						with your local data protection authority.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						7. Security
					</h2>
					<p>
						We use industry-standard measures to protect your data. No internet
						service is 100% secure, and we cannot guarantee absolute security.
						You are responsible for keeping your password safe.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						8. Children
					</h2>
					<p>
						This service is not directed at children under 13. If you are under
						18, you should have a parent or guardian&apos;s permission.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						9. Changes
					</h2>
					<p>
						We may update this policy. If we make significant changes, we will
						notify you by email or through the app.
					</p>
				</section>

				<section>
					<h2 className="mb-2 font-semibold text-foreground text-xl">
						10. Contact
					</h2>
					<p>
						Questions about your privacy? Reach us at{" "}
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
