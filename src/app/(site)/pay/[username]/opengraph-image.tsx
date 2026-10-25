import { ImageResponse } from "next/og";
import { OG } from "~/lib/og/brand";
import {
	AvatarCircle,
	BrandHeader,
	truncate,
} from "~/lib/og/components";
import { loadFonts } from "~/lib/og/fonts";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: OG.WIDTH, height: OG.HEIGHT };
export const alt = "Pay - Retrospend";

type PayData = {
	name: string | null;
	username: string | null;
	avatarPath: string | null;
	paymentMethods: { type: string; label: string | null }[];
};

function buildMethodSummary(
	methods: { type: string; label: string | null }[],
): string | null {
	if (methods.length === 0) return null;
	const names = methods.map((m) => m.label ?? m.type);
	if (names.length === 1) return names[0]!;
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	const extra = names.length - 2;
	return `${names[0]}, ${names[1]}, and ${extra} more`;
}

function renderPayCard(
	data: PayData,
	rawUsername: string,
	fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 }[],
) {
	const displayName = data.name ?? data.username ?? rawUsername;
	const avatarUrl = data.avatarPath
		? `${env.NEXT_PUBLIC_APP_URL}/api/images/${data.avatarPath}`
		: null;
	const methodSummary = buildMethodSummary(data.paymentMethods);

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
				<AvatarCircle avatarUrl={avatarUrl} name={displayName} size={110} />

				{/* "Pay Name" headline */}
				<span
					style={{
						fontSize: 52,
						fontWeight: 700,
						color: OG.DARK_FG,
						marginTop: 22,
						letterSpacing: "-0.025em",
						lineHeight: 1.1,
						textAlign: "center",
						maxWidth: 820,
					}}
				>
					Pay {truncate(displayName, 24)}
				</span>

				{/* Username */}
				{data.username && (
					<span
						style={{
							fontSize: 22,
							fontWeight: 400,
							color: OG.DARK_MUTED,
							marginTop: 8,
							letterSpacing: "0.01em",
						}}
					>
						@{truncate(data.username, 24)}
					</span>
				)}

				{/* CTA button */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						marginTop: 32,
						backgroundColor: OG.PRIMARY,
						borderRadius: 12,
						padding: "14px 40px",
					}}
				>
					<span
						style={{
							fontSize: 18,
							fontWeight: 700,
							color: OG.WHITE,
							letterSpacing: "0.01em",
						}}
					>
						Send Payment
					</span>
				</div>

				{/* Payment method hint */}
				{methodSummary && (
					<span
						style={{
							fontSize: 15,
							fontWeight: 400,
							color: OG.DARK_MUTED,
							marginTop: 14,
							letterSpacing: "0.01em",
						}}
					>
						{truncate(methodSummary, 60)}
					</span>
				)}
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
			paymentMethods: {
				where: { visibility: "PUBLIC" },
				orderBy: { rank: "asc" },
				take: 3,
				select: { type: true, label: true },
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
						paymentMethods: {
							where: { visibility: "PUBLIC" },
							orderBy: { rank: "asc" },
							take: 3,
							select: { type: true, label: true },
						},
					},
				},
			},
		});

		if (historyEntry) {
			return renderPayCard(historyEntry.user, username, fonts);
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
						Send Payment
					</span>
					<span
						style={{
							fontSize: 22,
							fontWeight: 400,
							color: OG.DARK_MUTED,
							marginTop: 10,
						}}
					>
						Pay someone on Retrospend
					</span>
				</div>
			),
			{ ...size, fonts },
		);
	}

	return renderPayCard(user, username, fonts);
}
