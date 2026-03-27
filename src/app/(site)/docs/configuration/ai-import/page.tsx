import type { Metadata } from "next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Callout } from "../../_components/callout"
import { CodeBlock } from "../../_components/code-block"
import { DocsNav } from "../../_components/docs-nav"
import { getAdjacentDocs } from "../../docs-config"

export const metadata: Metadata = {
	title: "AI Import",
	description: "Configure local Ollama or cloud OpenRouter for AI-powered bank statement import.",
}

const slug = "configuration/ai-import"

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

const ollamaVars: EnvVar[] = [
	{
		name: "OLLAMA_ENDPOINT",
		required: false,
		default: "http://ollama:11434/api/generate",
		description: "Ollama API endpoint. Use http://host.docker.internal:11434/api/generate if Ollama runs on the host.",
	},
	{
		name: "LLM_MODEL",
		required: false,
		default: "qwen2.5:7b",
		description: "Ollama model name. Must be pulled first.",
	},
]

const openrouterVars: EnvVar[] = [
	{
		name: "OPENROUTER_API_KEY",
		required: true,
		description: "Your OpenRouter API key. Get one at openrouter.ai.",
	},
	{
		name: "OPENROUTER_MODEL",
		required: false,
		default: "qwen/qwen-2.5-7b-instruct",
		description: "Model to use for import processing.",
	},
]

const tuningVars: EnvVar[] = [
	{
		name: "ENRICH_BATCH_SIZE",
		required: false,
		default: "20",
		description: "Number of merchants per LLM enrichment batch.",
	},
	{
		name: "ENRICH_CONCURRENCY",
		required: false,
		default: "3",
		description: "Max parallel enrichment calls. Auto-set to 20 for OpenRouter.",
	},
	{
		name: "PDF_CONCURRENCY",
		required: false,
		default: "3",
		description: "Max parallel PDF chunk parsing calls. Auto-set to 10 for OpenRouter.",
	},
]

export default function AiImportPage() {
	const { prev, next } = getAdjacentDocs(slug)

	return (
		<article>
			<div className="mb-8">
				<Badge variant="secondary" className="mb-3">
					Configuration
				</Badge>
				<h1 className="mb-3 font-bold text-3xl tracking-tight">AI Import</h1>
				<p className="text-lg text-muted-foreground leading-relaxed">
					Configure local Ollama or cloud OpenRouter for AI-powered bank
					statement import.
				</p>
			</div>

			<h2
				id="overview"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Overview
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The bank import feature uses an LLM to parse PDF and CSV bank statements
				into categorized transactions. You can use either a local Ollama instance
				or OpenRouter (cloud API). Only one provider is needed.
			</p>

			<h2
				id="providers"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Providers
			</h2>
			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">Ollama (Local)</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Free, runs on your hardware. Requires Docker or a local install.
							GPU is optional but speeds up processing.
						</p>
					</CardContent>
				</Card>
				<Card className="border-border bg-card">
					<CardContent className="p-4">
						<p className="font-semibold text-sm">OpenRouter (Cloud)</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Pay-per-token API. No local setup. Faster for large batches.
							Requires an API key from openrouter.ai.
						</p>
					</CardContent>
				</Card>
			</div>

			<h2
				id="ollama-setup"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Ollama Setup
			</h2>
			<EnvTable vars={ollamaVars} />
			<p className="mb-2 text-muted-foreground leading-relaxed">
				Pull the model before your first import:
			</p>
			<CodeBlock code={`docker exec local-ollama ollama pull qwen2.5:7b`} lang="bash" />
			<Callout variant="info">
				GPU is optional. Ollama runs fine on CPU for personal use. Processing is
				just slower.
			</Callout>

			<h2
				id="openrouter-setup"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				OpenRouter Setup
			</h2>
			<EnvTable vars={openrouterVars} />

			<h2
				id="tuning"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Tuning
			</h2>
			<EnvTable vars={tuningVars} />
			<p className="text-muted-foreground leading-relaxed">
				OpenRouter defaults are higher because cloud APIs handle concurrency
				better than a local GPU.
			</p>

			<h2
				id="access-control"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Access Control
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The admin controls who can use AI import. Options include a whitelist
				(only specified users), a blacklist (everyone except specified users),
				and per-user overrides. Monthly token quotas can be set to limit usage.
				All of this is managed from the admin panel.
			</p>

			<h2
				id="model-recommendation"
				className="mt-10 mb-2 font-bold text-xl tracking-tight scroll-mt-20"
			>
				Model Recommendation
			</h2>
			<p className="text-muted-foreground leading-relaxed">
				The default model (qwen2.5:7b) offers a good balance of speed and
				accuracy for transaction parsing. Larger models may improve accuracy for
				unusual statement formats but require more resources.
			</p>
			<Callout variant="tip">
				Start with the default model. Only change it if you see consistent
				misparses on your specific bank&#39;s format.
			</Callout>

			<DocsNav prev={prev} next={next} />
		</article>
	)
}
