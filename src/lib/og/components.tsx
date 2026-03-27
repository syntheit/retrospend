import {
	AVATAR_COLORS,
	OG,
	PROJECT_TYPE_EMOJI,
	PROJECT_TYPE_GRADIENTS,
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
				backgroundColor: OG.PRIMARY,
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
			<img
				alt=""
				height={size}
				src={avatarUrl}
				style={{ borderRadius: size / 2, objectFit: "cover" }}
				width={size}
			/>
		);
	}
	const color = getAvatarColor(name);
	const initials = getAvatarInitials(name);
	const fontSize = Math.round(size * 0.38);
	return (
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
	);
}

export function ProjectBadge({
	type,
	name,
	imageUrl,
	size,
}: {
	type: string;
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
	const [from, to] = PROJECT_TYPE_GRADIENTS[type] ??
		PROJECT_TYPE_GRADIENTS.GENERAL ?? ["#6366f1", "#9333ea"];
	const emoji = PROJECT_TYPE_EMOJI[type] ?? "GP";
	const hue = nameToHueRotate(name);
	const emojiSize = Math.round(size * 0.4);
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
			<span style={{ fontSize: emojiSize, lineHeight: 1 }}>{emoji}</span>
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

export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1).trimEnd() + "\u2026";
}
