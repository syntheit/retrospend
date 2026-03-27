import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Settings",
	description: "Profile, security, payment methods, notifications, and data management.",
}

const slug = "features/settings"

export default function SettingsPage() {
	const { prev, next } = getAdjacentDocs(slug)
	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">Features</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Settings</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					The settings page is organized into sections. Here&apos;s what each one covers.
				</p>
			</div>

			<h2 id="profile" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Profile
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Name, username, email, and avatar.
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Username</strong>: Must be unique. After changing, there&apos;s a 30-day cooldown before you can change it again. Your old username is reserved for 90 days so nobody else can claim it.</li>
				<li><strong>Email</strong>: Changing your email is a two-phase process. First, verify the new address. Then, the old address gets an alert. The switch only happens after the new address is confirmed.</li>
				<li><strong>Avatar</strong>: Upload and crop an image. Processed to 400x400 WebP.</li>
			</ul>
			<Callout variant="warning" title="Username cooldown">
				You can only change your username once every 30 days. Choose carefully.
			</Callout>

			<h2 id="security" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Security
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Password change (requires current password) and two-factor authentication (TOTP).
				Two-factor requires scanning a QR code with an authenticator app, then entering a
				confirmation code.
			</p>

			<h2 id="payment-methods" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Payment Methods
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Over 60 supported platforms (Venmo, PayPal, Zelle, Wise, crypto wallets, bank transfers,
				and more). Features:
			</p>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li>Drag-and-drop reorder to set your preferred order.</li>
				<li>Visibility settings: Public, Contacts Only, or Settlement Only.</li>
				<li>Crypto payment methods support network selection (e.g. Ethereum, Polygon, Solana).</li>
				<li>Minimum amount thresholds per method.</li>
			</ul>
			<p className="text-muted-foreground leading-relaxed">
				Payment methods show up when settling debts, making it easy for the other person to pay you.
			</p>

			<h2 id="notifications" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Notifications
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Per-type toggles for in-app notifications and email notifications. Types include shared
				expense updates, settlement confirmations, project invites, and verification requests.
				Digest mode batches email notifications instead of sending them one at a time.
			</p>

			<h2 id="privacy-and-data" className="mt-10 mb-4 font-bold text-xl tracking-tight scroll-mt-20">
				Privacy and Data
			</h2>
			<ul className="mb-4 list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Data export</strong>: Download all your expenses as a CSV file.</li>
				<li><strong>Account deletion</strong>: A multi-step process designed to prevent accidents. First, enter your password. Then, review a preview of what will be deleted (expense count, project count, etc.). Finally, type your username to confirm. Deletion is permanent.</li>
			</ul>
			<Callout variant="warning" title="Deletion is permanent">
				There is no undo. Export your data first if you want a backup.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
