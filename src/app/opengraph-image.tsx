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
					backgroundColor: OG.BG,
					fontFamily: "DM Sans",
					position: "relative",
				}}
			>
				{/* Decorative blob */}
				<div
					style={{
						position: "absolute",
						top: -80,
						left: -80,
						width: 400,
						height: 400,
						borderRadius: 200,
						background: `radial-gradient(circle, ${OG.PRIMARY}1F, transparent 70%)`,
					}}
				/>

				<BrandMark size={72} />
				<span
					style={{
						fontSize: 44,
						fontWeight: 700,
						color: OG.FG,
						marginTop: 20,
						letterSpacing: "-0.02em",
					}}
				>
					Retrospend
				</span>
				<span
					style={{
						fontSize: 24,
						fontWeight: 400,
						color: OG.MUTED_FG,
						marginTop: 12,
					}}
				>
					The Financial Multitool
				</span>
				<span
					style={{
						fontSize: 18,
						fontWeight: 400,
						color: OG.MUTED_FG,
						marginTop: 8,
					}}
				>
					Expenses, budgets, and wealth tracking.
				</span>
			</div>
		),
		{ ...size, fonts },
	);
}
