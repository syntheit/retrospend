import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Callout } from "../../_components/callout"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Email",
	description: "SMTP email configuration for transactional emails and notifications.",
}

const slug = "configuration/email"

type EnvVar = { name: string; required: boolean; default?: string; description: string }

function EnvTable({ vars }: { vars: EnvVar[] }) {
	return (
		<div className="my-4 overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-muted/30">
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Variable</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Required</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Default</th>
						<th className="px-4 py-2.5 text-left font-semibold text-xs">Description</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{vars.map((v) => (
						<tr key={v.name}>
							<td className="px-4 py-3 font-mono text-xs font-semibold">{v.name}</td>
							<td className="px-4 py-3">
								{v.required ? (
									<Badge variant="destructive" className="text-xs">required</Badge>
								) : (
									<Badge variant="secondary" className="text-xs">optional</Badge>
								)}
							</td>
							<td className="px-4 py-3 font-mono text-muted-foreground text-xs">{v.default ?? "-"}</td>
							<td className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">{v.description}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

const emailVars: EnvVar[] = [
	{
		name: "SMTP_HOST",
		required: false,
		description: "SMTP server hostname.",
	},
	{
		name: "SMTP_PORT",
		required: false,
		default: "587",
		description: "SMTP port. Use 465 for implicit TLS.",
	},
	{
		name: "SMTP_USER",
		required: false,
		description: "SMTP authentication username.",
	},
	{
		name: "SMTP_PASSWORD",
		required: false,
		description: "SMTP authentication password.",
	},
	{
		name: "EMAIL_FROM",
		required: false,
		description: "Sender address (e.g. Retrospend <noreply@your-domain.com>).",
	},
	{
		name: "UNSUBSCRIBE_SECRET",
		required: false,
		description: "Secret for signing one-click unsubscribe links. Generate with: openssl rand -base64 32",
	},
]

export default function EmailPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Configuration
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Email</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					SMTP configuration for transactional emails and notifications.
				</p>
			</div>

			<h2
				id="overview"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Overview
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend uses Nodemailer to send transactional emails via SMTP.
				Without SMTP configuration, emails are skipped and logged to the console
				instead.
			</p>

			<h2
				id="environment-variables"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Environment Variables
			</h2>
			<EnvTable vars={emailVars} />

			<h2
				id="tls"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				TLS
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				TLS is handled automatically based on the port. Port 465 uses implicit
				TLS. All other ports use STARTTLS when the server supports it.
			</p>

			<h2
				id="email-templates"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Email Templates
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Retrospend sends 8 types of emails:
			</p>
			<ul className="list-disc space-y-1.5 pl-6 text-muted-foreground text-sm leading-relaxed">
				<li><strong>Verification</strong>: sent on signup to confirm the email address.</li>
				<li><strong>Password reset</strong>: one-time link to set a new password.</li>
				<li><strong>Password changed</strong>: confirmation after a password update.</li>
				<li><strong>Email change verification</strong>: confirm the new address before switching.</li>
				<li><strong>Email change alert</strong>: notifies the old address that a change was requested.</li>
				<li><strong>Notifications</strong>: shared expense updates, settlements, project invites.</li>
				<li><strong>Feedback to admin</strong>: user feedback forwarded to the admin email.</li>
				<li><strong>SMTP test</strong>: sent from the admin panel to verify the configuration.</li>
			</ul>

			<h2
				id="unsubscribe"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Unsubscribe
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">UNSUBSCRIBE_SECRET</code>{" "}
				is used to generate signed one-click unsubscribe links in notification
				emails. When a user clicks the link, their notification preferences are
				updated without requiring login. If not set, unsubscribe links are
				omitted from emails.
			</p>

			<h2
				id="admin-controls"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Admin Controls
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The admin can toggle email sending globally from the admin panel.
				Individual users can manage their notification preferences in Settings.
			</p>
			<Callout variant="tip">
				Use the SMTP test button in the admin panel to verify your configuration
				before going live.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
