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
		const historyEntry = await db.usernameHistory.findFirst({
			where: { previousUsername: { equals: username, mode: "insensitive" } },
			select: { user: { select: { name: true, username: true } } },
		});
		if (historyEntry) {
			const redirectUser = historyEntry.user;
			const title = `Pay ${redirectUser.name}`;
			const description = `Pay ${redirectUser.name} on Retrospend via their preferred payment methods`;
			return {
				title,
				description,
				openGraph: { title: `Pay ${redirectUser.name} on Retrospend`, description },
				twitter: { card: "summary", title: `Pay ${redirectUser.name} on Retrospend`, description },
			};
		}

		return { title: "Pay" };
	}

	const title = `Pay ${user.name}`;
	const description = `Pay ${user.name} on Retrospend via their preferred payment methods`;

	return {
		title,
		description,
		openGraph: {
			title: `Pay ${user.name} on Retrospend`,
			description,
		},
		twitter: {
			card: "summary",
			title: `Pay ${user.name} on Retrospend`,
			description,
		},
	};
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
