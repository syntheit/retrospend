import type { Metadata } from "next"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table"
import { Badge } from "~/components/ui/badge"
import { DocItem } from "../../_components/doc-item"
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
			<Table className="w-full text-sm">
				<TableHeader>
					<TableRow className="border-b border-border bg-muted/30">
						<TableHead className="px-4 py-2.5 text-left font-semibold text-xs">Variable</TableHead>
						<TableHead className="px-4 py-2.5 text-left font-semibold text-xs">Required</TableHead>
						<TableHead className="px-4 py-2.5 text-left font-semibold text-xs">Default</TableHead>
						<TableHead className="px-4 py-2.5 text-left font-semibold text-xs">Description</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y divide-border">
					{vars.map((v) => (
						<TableRow key={v.name}>
							<TableCell className="px-4 py-3 font-mono text-xs font-semibold">{v.name}</TableCell>
							<TableCell className="px-4 py-3">
								{v.required ? (
									<Badge variant="destructive" className="text-xs">required</Badge>
								) : (
									<Badge variant="secondary" className="text-xs">optional</Badge>
								)}
							</TableCell>
							<TableCell className="px-4 py-3 font-mono text-muted-foreground text-xs">{v.default ?? "-"}</TableCell>
							<TableCell className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">{v.description}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
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
	{
		name: "EXPORT_DIR",
		required: false,
		default: "/data/exports",
		description: "Directory for finished data exports, kept 24 hours and served only to their owner. Must not be inside UPLOAD_DIR, which is public.",
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
				<h1 className="mb-3 font-semibold text-3xl">Storage</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Local filesystem storage for images and uploads.
				</p>
			</div>

			<h2
				id="overview"
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
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
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
			>
				Environment Variables
			</h2>
			<EnvTable vars={storageVars} />

			<h2
				id="directory-structure"
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
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
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
			>
				Image Processing
			</h2>
			<p className="mb-3 text-muted-foreground leading-relaxed">
				Uploaded images are automatically resized and converted to WebP.
			</p>
			<div className="grid gap-3 sm:grid-cols-3">
				<DocItem title="Avatars">400x400 WebP. Cropped on upload via the avatar editor.</DocItem>
				<DocItem title="Project Images">400x400 WebP. Used as project cover images.</DocItem>
				<DocItem title="Receipts">Max 1200px wide, WebP. Original aspect ratio preserved.</DocItem>
			</div>

			<h2
				id="supported-formats"
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
			>
				Supported Formats
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				JPEG, PNG, WebP, and GIF. Files are validated by magic bytes, not just
				the file extension. Maximum upload size is 5 MB.
			</p>

			<h2
				id="security"
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
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
				className="mt-10 mb-2 font-semibold text-xl scroll-mt-20"
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
