import {
	AVATAR_COLORS,
	OG,
	PROJECT_DEFAULT_GRADIENT,
} from "./brand";

function getAvatarColor(name: string): string {
	let sum = 0;
	for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
	return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

function getAvatarInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) {
		const p = parts[0]!;
		return p.length >= 2
			? (p[0]! + p[1]!).toUpperCase()
			: p[0]!.toUpperCase();
	}
	return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hashName(name: string): number {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) | 0;
	}
	return hash;
}

function nameToHueRotate(name: string): number {
	const h = hashName(name);
	return (h % 31) - 15;
}

export function BrandMark({ size }: { size: number }) {
	const fontSize = Math.round(size * 0.52);
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				borderRadius: size / 2,
				background: `linear-gradient(135deg, #8b7355, ${OG.PRIMARY})`,
				boxShadow: `0 0 ${Math.round(size * 0.4)}px rgba(107,92,79,0.45)`,
			}}
		>
			<span
				style={{
					color: "white",
					fontSize,
					fontWeight: 700,
					lineHeight: 1,
				}}
			>
				R
			</span>
		</div>
	);
}

export function AvatarCircle({
	name,
	avatarUrl,
	size,
}: {
	name: string;
	avatarUrl?: string | null;
	size: number;
}) {
	if (avatarUrl) {
		return (
			<div
				style={{
					display: "flex",
					width: size + 6,
					height: size + 6,
					borderRadius: (size + 6) / 2,
					background: "rgba(255,255,255,0.15)",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<img
					alt=""
					height={size}
					src={avatarUrl}
					style={{ borderRadius: size / 2, objectFit: "cover" }}
					width={size}
				/>
			</div>
		);
	}
	const color = getAvatarColor(name);
	const initials = getAvatarInitials(name);
	const fontSize = Math.round(size * 0.38);
	return (
		<div
			style={{
				display: "flex",
				width: size + 6,
				height: size + 6,
				borderRadius: (size + 6) / 2,
				background: "rgba(255,255,255,0.15)",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: color,
				}}
			>
				<span
					style={{
						color: "white",
						fontSize,
						fontWeight: 600,
						lineHeight: 1,
					}}
				>
					{initials}
				</span>
			</div>
		</div>
	);
}

export function ProjectBadge({
	name,
	imageUrl,
	size,
}: {
	name: string;
	imageUrl?: string | null;
	size: number;
}) {
	if (imageUrl) {
		return (
			<img
				alt=""
				height={size}
				src={imageUrl}
				style={{ borderRadius: size / 2, objectFit: "cover" }}
				width={size}
			/>
		);
	}
	const [from, to] = PROJECT_DEFAULT_GRADIENT;
	const initials = name.slice(0, 2).toUpperCase();
	const hue = nameToHueRotate(name);
	const initialsSize = Math.round(size * 0.4);
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
				filter: `hue-rotate(${hue}deg)`,
			}}
		>
			<span style={{ fontSize: initialsSize, lineHeight: 1, color: "rgba(255,255,255,0.7)" }}>{initials}</span>
		</div>
	);
}

// Branded header strip for dark-bg cards
export function BrandHeader() {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				position: "absolute",
				top: 36,
				left: 52,
			}}
		>
			<BrandMark size={32} />
			<span
				style={{
					fontSize: 20,
					color: OG.DARK_MUTED,
					fontWeight: 500,
					letterSpacing: "0.02em",
				}}
			>
				Retrospend
			</span>
		</div>
	);
}

export function Footer() {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				position: "absolute",
				bottom: 32,
				right: 48,
			}}
		>
			<BrandMark size={28} />
			<span
				style={{
					fontSize: 18,
					color: OG.MUTED_FG,
					fontWeight: 400,
				}}
			>
				Retrospend
			</span>
		</div>
	);
}

// A small pill badge — label/value pair used on dark hero cards
export function StatPill({ label }: { label: string }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				backgroundColor: OG.DARK_SURFACE,
				border: `1px solid ${OG.DARK_BORDER}`,
				borderRadius: 24,
				padding: "7px 18px",
			}}
		>
			<span
				style={{
					fontSize: 15,
					fontWeight: 400,
					color: OG.DARK_MUTED,
					letterSpacing: "0.01em",
				}}
			>
				{label}
			</span>
		</div>
	);
}

export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1).trimEnd() + "…";
}
