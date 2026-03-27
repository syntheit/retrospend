import type { Metadata } from "next";
import { db } from "~/server/db";

type Props = {
	params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { username } = await params;

	const user = await db.user.findFirst({
		where: { username: { equals: username, mode: "insensitive" } },
		select: { name: true, username: true },
	});

	if (!user) {
		// Check username history for redirect - use current user's metadata
		const historyEntry = await db.usernameHistory.findFirst({
			where: { previousUsername: { equals: username, mode: "insensitive" } },
			select: { user: { select: { name: true, username: true } } },
		});
		if (historyEntry) {
			const redirectUser = historyEntry.user;
			const title = `${redirectUser.name} on Retrospend`;
			const description = `View payment methods and pay ${redirectUser.name} on Retrospend`;
			return {
				title: { absolute: title },
				description,
				openGraph: { title, description },
				twitter: { card: "summary", title, description },
			};
		}

		return { title: { absolute: "Profile not found - Retrospend" } };
	}

	const title = `${user.name} on Retrospend`;
	const description = `View payment methods and pay ${user.name} on Retrospend`;

	return {
		// absolute avoids the root template adding "- Retrospend" (it's already in the title)
		title: { absolute: title },
		description,
		openGraph: {
			title,
			description,
		},
		twitter: {
			card: "summary",
			title,
			description,
		},
	};
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
