"use client"

import { BookOpen, Menu } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "~/components/ui/button"
import { useTranslations } from "next-intl"
import { Sheet } from "~/components/ui/sheet"
import { Tip } from "~/components/ui/tooltip"
import { useSession } from "~/hooks/use-session"
import { DocsSidebar } from "./docs-sidebar"

const REFERRER_KEY = "docs-referrer"

export function DocsHeader() {
	const t = useTranslations("landing")
	const [open, setOpen] = useState(false)
	const { data: session } = useSession()
	const searchParams = useSearchParams()
	const [referrer, setReferrer] = useState<"app" | "site" | null>(null)

	useEffect(() => {
		const fromParam = searchParams.get("from")
		if (fromParam === "app" || fromParam === "site") {
			sessionStorage.setItem(REFERRER_KEY, fromParam)
			setReferrer(fromParam)
		} else {
			const stored = sessionStorage.getItem(REFERRER_KEY)
			if (stored === "app" || stored === "site") {
				setReferrer(stored)
			}
		}
	}, [searchParams])

	const isLoggedIn = !!session?.user

	return (
		<header className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
			<div className="flex h-14 items-center gap-3 px-4 lg:px-6">
				{/* Mobile sidebar trigger */}
				<Tip content={t("openMenu")}>
					<Button
						aria-label={t("openMenu")}
						className="shrink-0 lg:hidden"
						icon
						kind="ghost"
						onClick={() => setOpen(true)}
					>
						<Menu />
					</Button>
				</Tip>
				<Sheet
					footer={false}
					onOpenChange={setOpen}
					open={open}
					title={t("docsMenu")}
				>
					<DocsSidebar onNavigate={() => setOpen(false)} />
				</Sheet>

				{/* Brand */}
				<Link href="/docs" className="flex items-center gap-2 shrink-0">
					<BookOpen className="h-4 w-4 text-primary" />
					<span className="font-semibold text-sm">
						<span className="text-muted-foreground">Retrospend</span>
						<span className="mx-1 text-border">/</span>
						<span>Docs</span>
					</span>
				</Link>

				<div className="flex-1" />

				{referrer === "app" && (
					<Link
						href="/home"
						className="hidden text-muted-foreground text-sm transition-colors hover:text-foreground sm:block"
					>
						← Back to app
					</Link>
				)}
				{referrer === "site" && (
					<Link
						href="/"
						className="hidden text-muted-foreground text-sm transition-colors hover:text-foreground sm:block"
					>
						← Back to site
					</Link>
				)}

				<Button asChild kind="primary">
					{isLoggedIn ? (
						<Link href="/home">Open App</Link>
					) : (
						<Link href="/signup">Get Started</Link>
					)}
				</Button>
			</div>
		</header>
	)
}
