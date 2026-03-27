import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { Button } from "~/components/ui/button"
import { Separator } from "~/components/ui/separator"
import type { DocPage } from "../docs-config"

interface DocsNavProps {
	prev?: DocPage
	next?: DocPage
}

export function DocsNav({ prev, next }: DocsNavProps) {
	return (
		<>
			<Separator className="my-10" />
			<div className="flex items-stretch gap-4">
				{prev ? (
					<Button
						variant="outline"
						asChild
						className="h-auto flex-1 justify-start py-3"
					>
						<Link href={`/docs/${prev.slug}`}>
							<ChevronLeft className="mr-2 h-4 w-4 shrink-0" />
							<div className="text-left">
								<div className="text-muted-foreground text-xs">Previous</div>
								<div className="font-medium text-sm">{prev.title}</div>
							</div>
						</Link>
					</Button>
				) : (
					<div className="flex-1" />
				)}
				{next ? (
					<Button
						variant="outline"
						asChild
						className="h-auto flex-1 justify-end py-3"
					>
						<Link href={`/docs/${next.slug}`}>
							<div className="text-right">
								<div className="text-muted-foreground text-xs">Next</div>
								<div className="font-medium text-sm">{next.title}</div>
							</div>
							<ChevronRight className="ml-2 h-4 w-4 shrink-0" />
						</Link>
					</Button>
				) : (
					<div className="flex-1" />
				)}
			</div>
		</>
	)
}
