import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ShellModeProvider } from "~/components/shell/shell-context";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

export const metadata: Metadata = {
	title: "Project",
	description: "View a shared expense project",
};

// The page draws the shell itself (it also serves guests and public links),
// so the layout only tells it which shell this viewer gets from uiV2Mode.
export default async function Layout({ children }: { children: ReactNode }) {
	const session = await getWebSession(await headers());
	const uiV2 =
		session?.user.isActive === true &&
		(await isFlagEnabled("uiV2", session.user));
	return (
		<ShellModeProvider mode={uiV2 ? "v2" : "legacy"}>
			{children}
		</ShellModeProvider>
	);
}
