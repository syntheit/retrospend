import { ImageResponse } from "next/og";
import { OG } from "~/lib/og/brand";
import { AvatarCircle, Footer, truncate } from "~/lib/og/components";
import { loadFonts } from "~/lib/og/fonts";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: OG.WIDTH, height: OG.HEIGHT };
export const alt = "Pay - Retrospend";

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
		// Check username history - use current user's data for OG image
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
			const u = historyEntry.user;
			const displayName = u.name ?? u.username ?? username;
			const avatarUrl = u.avatarPath
				? `${env.NEXT_PUBLIC_APP_URL}/api/images/${u.avatarPath}`
				: null;

			let methodSummary: string | null = null;
			if (u.paymentMethods.length > 0) {
				const names = u.paymentMethods.map((m) => m.label ?? m.type);
				if (names.length === 1) {
					methodSummary = names[0]!;
				} else if (names.length === 2) {
					methodSummary = `${names[0]} and ${names[1]}`;
				} else {
					const extra = names.length - 2;
					methodSummary = `${names[0]}, ${names[1]}, and ${extra} more`;
				}
			}

			return new ImageResponse(
				(
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "100%",
							height: "100%",
							backgroundColor: OG.BG,
							fontFamily: "DM Sans",
							position: "relative",
						}}
					>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								backgroundColor: OG.CARD,
								border: `1px solid ${OG.BORDER}`,
								borderRadius: OG.RADIUS,
								boxShadow: OG.CARD_SHADOW,
								padding: 48,
								minWidth: 420,
							}}
						>
							<AvatarCircle
								avatarUrl={avatarUrl}
								name={displayName}
								size={88}
							/>
							<span
								style={{
									fontSize: 34,
									fontWeight: 700,
									color: OG.FG,
									marginTop: 16,
									textAlign: "center",
								}}
							>
								Pay {truncate(displayName, 25)}
							</span>
							{u.username && (
								<span
									style={{
										fontSize: 18,
										fontWeight: 400,
										color: OG.MUTED_FG,
										marginTop: 6,
									}}
								>
									@{u.username}
								</span>
							)}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									marginTop: 24,
									backgroundColor: OG.PRIMARY,
									borderRadius: 8,
									padding: "12px 32px",
								}}
							>
								<span
									style={{
										fontSize: 16,
										fontWeight: 700,
										color: "white",
									}}
								>
									Send Payment
								</span>
							</div>
							{methodSummary && (
								<span
									style={{
										fontSize: 14,
										fontWeight: 400,
										color: OG.MUTED_FG,
										marginTop: 12,
									}}
								>
									{methodSummary}
								</span>
							)}
						</div>
						<Footer />
					</div>
				),
				{ ...size, fonts },
			);
		}

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
						backgroundColor: OG.BG,
						fontFamily: "DM Sans",
						position: "relative",
					}}
				>
					<AvatarCircle name="?" size={80} />
					<span
						style={{
							fontSize: 32,
							fontWeight: 700,
							color: OG.FG,
							marginTop: 16,
						}}
					>
						Send Payment
					</span>
					<span
						style={{
							fontSize: 18,
							fontWeight: 400,
							color: OG.MUTED_FG,
							marginTop: 8,
						}}
					>
						Pay someone on Retrospend
					</span>
					<Footer />
				</div>
			),
			{ ...size, fonts },
		);
	}

	const displayName = user.name ?? user.username ?? username;
	const avatarUrl = user.avatarPath
		? `${env.NEXT_PUBLIC_APP_URL}/api/images/${user.avatarPath}`
		: null;

	// Build payment method summary
	let methodSummary: string | null = null;
	if (user.paymentMethods.length > 0) {
		const names = user.paymentMethods.map(
			(m) => m.label ?? m.type,
		);
		if (names.length === 1) {
			methodSummary = names[0]!;
		} else if (names.length === 2) {
			methodSummary = `${names[0]} and ${names[1]}`;
		} else {
			const extra = names.length - 2;
			methodSummary = `${names[0]}, ${names[1]}, and ${extra} more`;
		}
	}

	return new ImageResponse(
		(
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "100%",
					height: "100%",
					backgroundColor: OG.BG,
					fontFamily: "DM Sans",
					position: "relative",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						backgroundColor: OG.CARD,
						border: `1px solid ${OG.BORDER}`,
						borderRadius: OG.RADIUS,
						boxShadow: OG.CARD_SHADOW,
						padding: 48,
						minWidth: 420,
					}}
				>
					<AvatarCircle
						avatarUrl={avatarUrl}
						name={displayName}
						size={88}
					/>
					<span
						style={{
							fontSize: 34,
							fontWeight: 700,
							color: OG.FG,
							marginTop: 16,
							textAlign: "center",
						}}
					>
						Pay {truncate(displayName, 25)}
					</span>
					{user.username && (
						<span
							style={{
								fontSize: 18,
								fontWeight: 400,
								color: OG.MUTED_FG,
								marginTop: 6,
							}}
						>
							@{user.username}
						</span>
					)}
					{/* CTA button */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							marginTop: 24,
							backgroundColor: OG.PRIMARY,
							borderRadius: 8,
							padding: "12px 32px",
						}}
					>
						<span
							style={{
								fontSize: 16,
								fontWeight: 700,
								color: "white",
							}}
						>
							Send Payment
						</span>
					</div>
					{methodSummary && (
						<span
							style={{
								fontSize: 14,
								fontWeight: 400,
								color: OG.MUTED_FG,
								marginTop: 12,
							}}
						>
							{methodSummary}
						</span>
					)}
				</div>
				<Footer />
			</div>
		),
		{ ...size, fonts },
	);
}
