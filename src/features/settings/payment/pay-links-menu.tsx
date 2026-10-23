"use client";

import { Heart, Link2, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";

/** The three links today's card copies: pay, profile and donation. */
export function payLinks(origin: string, username: string) {
	const base = origin.replace(/\/$/, "");
	return {
		pay: `${base}/pay/${username}`,
		profile: `${base}/u/${username}`,
		donation: `${base}/u/${username}?donate`,
	};
}

/** One Copy link menu for the pay, profile and donation links (mockup). */
export function PayLinksMenu({ children }: { children: ReactNode }) {
	const t = useTranslations("settingsV2.payment");
	const toast = useToast();
	const { data: session } = useSession();
	const username = (session?.user as { username?: string } | undefined)
		?.username;
	if (!username) return null;

	const copy = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			toast.info(t("linkCopied"));
		} catch {
			toast.failed(t("copyFailed"));
		}
	};
	const links = () => payLinks(window.location.origin, username);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button kind="ghost" size="sm">
					{children}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuItem onSelect={() => void copy(links().pay)}>
					<Link2 aria-hidden="true" />
					{t("copyPayLink")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void copy(links().profile)}>
					<User aria-hidden="true" />
					{t("copyProfileLink")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void copy(links().donation)}>
					<Heart aria-hidden="true" />
					{t("copyDonationLink")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
