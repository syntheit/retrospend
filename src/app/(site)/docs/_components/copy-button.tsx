"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

export function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		await navigator.clipboard.writeText(code.trim())
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<button
			onClick={handleCopy}
			aria-label="Copy code"
			className="absolute right-3 top-3 rounded-md border border-border bg-background p-1.5 text-muted-foreground md:opacity-0 transition-all hover:text-foreground md:group-hover:opacity-100"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-emerald-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</button>
	)
}
