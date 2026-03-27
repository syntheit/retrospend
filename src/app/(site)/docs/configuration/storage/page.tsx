import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "Storage",
	description: "Local filesystem storage for images and uploads.",
}

const slug = "configuration/storage"

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

const storageVars: EnvVar[] = [
	{
		name: "UPLOAD_DIR",
		required: false,
		default: "/data/uploads",
		description: "Directory path where uploaded files are stored. In Docker this is a named volume mounted at /data/uploads.",
	},
]

export default function StoragePage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Configuration
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">Storage</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Local filesystem storage for images and uploads.
				</p>
			</div>

			<h2
				id="overview"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Overview
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Retrospend stores uploaded files (avatars, project images, receipts) on
				the local filesystem. In Docker, this is a named volume mounted at{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">/data/uploads</code>.
				No extra services or configuration required.
			</p>

			<h2
				id="environment-variables"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Environment Variables
			</h2>
			<EnvTable vars={storageVars} />

			<h2
				id="directory-structure"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Directory Structure
			</h2>
			<pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm leading-relaxed">
{`/data/uploads/
  avatars/{userId}-{timestamp}.webp
  projects/{projectId}-{timestamp}.webp
  receipts/{userId}/{filename}.webp`}
			</pre>

			<h2
				id="image-processing"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Image Processing
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Uploaded images are automatically resized and converted to WebP.
			</p>
			<div className="grid gap-3 sm:grid-cols-3">
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Avatars</p>
						<p className="mt-1 text-muted-foreground text-sm">
							400x400 WebP. Cropped on upload via the avatar editor.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Project Images</p>
						<p className="mt-1 text-muted-foreground text-sm">
							400x400 WebP. Used as project cover images.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Receipts</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Max 1200px wide, WebP. Original aspect ratio preserved.
						</p>
					</CardContent>
				</Card>
			</div>

			<h2
				id="supported-formats"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Supported Formats
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				JPEG, PNG, WebP, and GIF. Files are validated by magic bytes, not just
				the file extension. Maximum upload size is 5 MB.
			</p>

			<h2
				id="security"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Security
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				Images are served through the{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">/api/images/</code>{" "}
				route, not directly from the filesystem. Path traversal is prevented by
				rejecting paths containing <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">..</code>{" "}
				and validating all path characters.
			</p>

			<h2
				id="backups"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Backups
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The uploads directory is a standard Docker named volume. Back it up with
				your preferred Docker volume backup tool, or mount a host directory
				instead for direct filesystem backups.
			</p>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
