import { codeToHtml } from "shiki"
import { cn } from "~/lib/utils"
import { CopyButton } from "./copy-button"

interface CodeBlockProps {
	code: string
	lang?: string
	filename?: string
	className?: string
}

export async function CodeBlock({
	code,
	lang,
	filename,
	className,
}: CodeBlockProps) {
	const highlighted = await codeToHtml(code.trim(), {
		lang: lang ?? "text",
		themes: {
			light: "github-light",
			dark: "github-dark",
		},
		defaultColor: false,
	})

	return (
		<div
			className={cn(
				"group relative my-5 overflow-hidden rounded-lg border border-border",
				className,
			)}
		>
			{(filename ?? lang) && (
				<div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
					<span className="font-mono text-muted-foreground text-xs">
						{filename ?? lang}
					</span>
					<span className="text-muted-foreground/60 text-xs">{lang}</span>
				</div>
			)}
			<div className="relative">
				<div
					className="docs-code-block overflow-x-auto bg-muted/20 [&>pre]:p-4 [&>pre]:font-mono [&>pre]:text-sm [&>pre]:leading-relaxed"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is safe
					dangerouslySetInnerHTML={{ __html: highlighted }}
				/>
				<CopyButton code={code} />
			</div>
		</div>
	)
}
