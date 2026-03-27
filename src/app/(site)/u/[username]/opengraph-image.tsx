import { ImageResponse } from "next/og";
import { OG } from "~/lib/og/brand";
import { AvatarCircle, Footer, truncate } from "~/lib/og/components";
import { loadFonts } from "~/lib/og/fonts";
import { env } from "~/env";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: OG.WIDTH, height: OG.HEIGHT };
export const alt = "User Profile - Retrospend";

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
		// Check username history - use current user's data for OG image
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
			// Re-use the found user and fall through to the normal rendering below
			const u = historyEntry.user;
			const displayName = u.name ?? u.username ?? username;
			const avatarUrl = u.avatarPath
				? `${env.NEXT_PUBLIC_APP_URL}/api/images/${u.avatarPath}`
				: null;
			const memberSince = u.createdAt.toLocaleDateString("en-US", {
				month: "short",
				year: "numeric",
			});
			const methodCount = u._count.paymentMethods;

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
								size={96}
							/>
							<span
								style={{
									fontSize: 36,
									fontWeight: 700,
									color: OG.FG,
									marginTop: 16,
									textAlign: "center",
								}}
							>
								{truncate(displayName, 25)}
							</span>
							{u.username && (
								<span
									style={{
										fontSize: 20,
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
									marginTop: 16,
									backgroundColor: OG.SECONDARY,
									borderRadius: 16,
									padding: "6px 16px",
								}}
							>
								<span
									style={{
										fontSize: 14,
										fontWeight: 400,
										color: OG.MUTED_FG,
									}}
								>
									Member since {memberSince}
								</span>
							</div>
							<div
								style={{
									display: "flex",
									width: 200,
									height: 1,
									backgroundColor: OG.BORDER,
									marginTop: 20,
								}}
							/>
							{methodCount > 0 && (
								<span
									style={{
										fontSize: 16,
										fontWeight: 400,
										color: OG.MUTED_FG,
										marginTop: 16,
									}}
								>
									{methodCount} payment method
									{methodCount === 1 ? "" : "s"} available
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
						User Profile
					</span>
					<span
						style={{
							fontSize: 18,
							fontWeight: 400,
							color: OG.MUTED_FG,
							marginTop: 8,
						}}
					>
						View this profile on Retrospend
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
	const memberSince = user.createdAt.toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
	});
	const methodCount = user._count.paymentMethods;

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
						size={96}
					/>
					<span
						style={{
							fontSize: 36,
							fontWeight: 700,
							color: OG.FG,
							marginTop: 16,
							textAlign: "center",
						}}
					>
						{truncate(displayName, 25)}
					</span>
					{user.username && (
						<span
							style={{
								fontSize: 20,
								fontWeight: 400,
								color: OG.MUTED_FG,
								marginTop: 6,
							}}
						>
							@{user.username}
						</span>
					)}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							marginTop: 16,
							backgroundColor: OG.SECONDARY,
							borderRadius: 16,
							padding: "6px 16px",
						}}
					>
						<span
							style={{
								fontSize: 14,
								fontWeight: 400,
								color: OG.MUTED_FG,
							}}
						>
							Member since {memberSince}
						</span>
					</div>
					{/* Divider */}
					<div
						style={{
							display: "flex",
							width: 200,
							height: 1,
							backgroundColor: OG.BORDER,
							marginTop: 20,
						}}
					/>
					{methodCount > 0 && (
						<span
							style={{
								fontSize: 16,
								fontWeight: 400,
								color: OG.MUTED_FG,
								marginTop: 16,
							}}
						>
							{methodCount} payment method
							{methodCount === 1 ? "" : "s"} available
						</span>
					)}
				</div>
				<Footer />
			</div>
		),
		{ ...size, fonts },
	);
}
