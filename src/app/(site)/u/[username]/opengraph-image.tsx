import { ImageResponse } from "next/og";
import { OG } from "~/lib/og/brand";
import {
	AvatarCircle,
	BrandHeader,
	StatPill,
	truncate,
} from "~/lib/og/components";
import { loadFonts } from "~/lib/og/fonts";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: OG.WIDTH, height: OG.HEIGHT };
export const alt = "User Profile - Retrospend";

type ProfileData = {
	name: string | null;
	username: string | null;
	avatarPath: string | null;
	createdAt: Date;
	_count: { paymentMethods: number };
};

function renderProfileCard(
	data: ProfileData,
	rawUsername: string,
	fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 }[],
) {
	const displayName = data.name ?? data.username ?? rawUsername;
	const avatarUrl = data.avatarPath
		? `${env.NEXT_PUBLIC_APP_URL}/api/images/${data.avatarPath}`
		: null;
	const memberSince = data.createdAt.toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
	});
	const methodCount = data._count.paymentMethods;

	return new ImageResponse(
		(
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					width: "100%",
					height: "100%",
					backgroundColor: OG.DARK_BG,
					fontFamily: "DM Sans",
					position: "relative",
					overflow: "hidden",
				}}
			>

				{/* Brand header top-left */}
				<BrandHeader />

				{/* Avatar */}
				<AvatarCircle avatarUrl={avatarUrl} name={displayName} size={120} />

				{/* Display name */}
				<span
					style={{
						fontSize: 54,
						fontWeight: 700,
						color: OG.DARK_FG,
						marginTop: 20,
						letterSpacing: "-0.025em",
						lineHeight: 1.1,
						textAlign: "center",
						maxWidth: 800,
					}}
				>
					{truncate(displayName, 28)}
				</span>

				{/* Username */}
				{data.username && (
					<span
						style={{
							fontSize: 24,
							fontWeight: 400,
							color: OG.DARK_MUTED,
							marginTop: 8,
							letterSpacing: "0.01em",
						}}
					>
						@{truncate(data.username, 24)}
					</span>
				)}

				{/* Stats row */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: 12,
						marginTop: 28,
					}}
				>
					<StatPill label={`Member since ${memberSince}`} />
					{methodCount > 0 && (
						<StatPill
							label={`${methodCount} payment method${methodCount === 1 ? "" : "s"}`}
						/>
					)}
				</div>
			</div>
		),
		{ ...size, fonts },
	);
}

export default async function Image({
	params,
}: {
	params: Promise<{ username: string }>;
}) {
	const { username } = await params;
	const fonts = await loadFonts();

	const user = await db.user.findFirst({
		where: { username: { equals: username, mode: "insensitive" } },
		select: {
			name: true,
			username: true,
			avatarPath: true,
			createdAt: true,
			_count: {
				select: {
					paymentMethods: { where: { visibility: "PUBLIC" } },
				},
			},
		},
	});

	if (!user) {
		// Check username history, use current user's data for OG image
		const historyEntry = await db.usernameHistory.findFirst({
			where: { previousUsername: { equals: username, mode: "insensitive" } },
			select: {
				user: {
					select: {
						name: true,
						username: true,
						avatarPath: true,
						createdAt: true,
						_count: {
							select: {
								paymentMethods: { where: { visibility: "PUBLIC" } },
							},
						},
					},
				},
			},
		});

		if (historyEntry) {
			return renderProfileCard(historyEntry.user, username, fonts);
		}

		// Generic fallback for unknown username
		return new ImageResponse(
			(
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						width: "100%",
						height: "100%",
						backgroundColor: OG.DARK_BG,
						fontFamily: "DM Sans",
						position: "relative",
						overflow: "hidden",
					}}
				>
					<BrandHeader />
					<AvatarCircle name="?" size={100} />
					<span
						style={{
							fontSize: 42,
							fontWeight: 700,
							color: OG.DARK_FG,
							marginTop: 20,
							letterSpacing: "-0.02em",
						}}
					>
						User Profile
					</span>
					<span
						style={{
							fontSize: 22,
							fontWeight: 400,
							color: OG.DARK_MUTED,
							marginTop: 10,
						}}
					>
						View this profile on Retrospend
					</span>
				</div>
			),
			{ ...size, fonts },
		);
	}

	return renderProfileCard(user, username, fonts);
}
