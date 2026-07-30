import { ImageResponse } from "next/og";
import { OG } from "~/lib/og/brand";
import { BrandMark } from "~/lib/og/components";
import { loadFonts } from "~/lib/og/fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: OG.WIDTH, height: OG.HEIGHT };
export const alt = "Retrospend - The Financial Multitool";

export default async function Image() {
	const fonts = await loadFonts();

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
					background: `linear-gradient(135deg, ${OG.DARK_BG_FROM} 0%, ${OG.DARK_BG_VIA} 55%, ${OG.DARK_BG_TO} 100%)`,
					fontFamily: "DM Sans",
					position: "relative",
					overflow: "hidden",
				}}
			>
				{/* Decorative depth circles — top-right */}
				<div
					style={{
						position: "absolute",
						top: -100,
						right: -100,
						width: 480,
						height: 480,
						borderRadius: 240,
						background: "rgba(255,255,255,0.04)",
					}}
				/>
				<div
					style={{
						position: "absolute",
						top: -40,
						right: -40,
						width: 280,
						height: 280,
						borderRadius: 140,
						background: "rgba(255,255,255,0.035)",
					}}
				/>
				{/* Decorative depth circles — bottom-left */}
				<div
					style={{
						position: "absolute",
						bottom: -120,
						left: -120,
						width: 440,
						height: 440,
						borderRadius: 220,
						background: "rgba(255,255,255,0.03)",
					}}
				/>

				{/* Brand lockup */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 20,
						marginBottom: 28,
					}}
				>
					<BrandMark size={80} />
				</div>

				<span
					style={{
						fontSize: 72,
						fontWeight: 700,
						color: OG.DARK_FG,
						letterSpacing: "-0.03em",
						lineHeight: 1,
					}}
				>
					Retrospend
				</span>

				<span
					style={{
						fontSize: 26,
						fontWeight: 400,
						color: OG.DARK_MUTED,
						marginTop: 16,
						letterSpacing: "0.01em",
					}}
				>
					The Financial Multitool
				</span>

				{/* Feature pills row */}
				<div
					style={{
						display: "flex",
						flexDirection: "row",
						gap: 12,
						marginTop: 40,
					}}
				>
					{["Expense Tracking", "Budgets", "Wealth Overview"].map((label) => (
						<div
							key={label}
							style={{
								display: "flex",
								alignItems: "center",
								backgroundColor: OG.DARK_SURFACE,
								border: `1px solid ${OG.DARK_BORDER}`,
								borderRadius: 24,
								padding: "9px 20px",
							}}
						>
							<span
								style={{
									fontSize: 16,
									fontWeight: 500,
									color: OG.DARK_MUTED,
									letterSpacing: "0.01em",
								}}
							>
								{label}
							</span>
						</div>
					))}
				</div>
			</div>
		),
		{ ...size, fonts },
	);
}
