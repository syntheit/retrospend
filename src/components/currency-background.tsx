"use client";

import { memo, useMemo } from "react";

// ---------------------------------------------------------------------------
// Symbol sets
// ---------------------------------------------------------------------------
const SYMBOL_SETS = {
	currency: "$ € £ ¥ ₿ ₽ ₺ ₩ ₹ ₴ ₡ ₦ ₱ ₪ ₫ ₮ ₸ ₼ ₾ ₲".split(" "),
	math: "+ − × ÷ = % ± ∑ √ π ∞ Δ".split(" "),
	finance: "# @ & ¢ ‰".split(" "),
} as const;

type SymbolSet = keyof typeof SYMBOL_SETS;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface CurrencyBackgroundProps {
	/** Which symbol sets to include */
	symbolSets: SymbolSet[];
	/** Color theme */
	color: "gray" | "green" | "blue" | "purple" | "orange" | "gold";
	/** How many symbols to scatter */
	density: "sparse" | "medium" | "dense";
	/** Animation style */
	animation: "static" | "float" | "pulse";
	/** Overall opacity level */
	opacity: "subtle" | "medium" | "bold";
	/** Seed string (e.g. username) for deterministic layout */
	seed: string;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------
function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(31, h) + s.charCodeAt(i);
		h |= 0;
	}
	return h >>> 0;
}

function mulberry32(seed: number) {
	let t = seed + 0x6d2b79f5;
	return () => {
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------
// Config maps
// ---------------------------------------------------------------------------
const COLOR_CLASS: Record<CurrencyBackgroundProps["color"], string> = {
	gray: "text-neutral-400",
	green: "text-emerald-400",
	blue: "text-blue-400",
	purple: "text-purple-400",
	orange: "text-orange-400",
	gold: "text-yellow-400",
};

const DENSITY_COUNT: Record<CurrencyBackgroundProps["density"], number> = {
	sparse: 25,
	medium: 45,
	dense: 70,
};

const OPACITY_RANGE: Record<
	CurrencyBackgroundProps["opacity"],
	[number, number]
> = {
	subtle: [0.08, 0.14],
	medium: [0.15, 0.22],
	bold: [0.25, 0.35],
};

// ---------------------------------------------------------------------------
// Symbol data generation
// ---------------------------------------------------------------------------
interface SymbolData {
	char: string;
	x: number;
	y: number;
	size: number;
	rotation: number;
	opacity: number;
	animDuration: number;
	animDelay: number;
}

function generateSymbols(
	seed: string,
	symbols: string[],
	count: number,
	opacityRange: [number, number],
): SymbolData[] {
	const rng = mulberry32(hashString(seed));
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

	// Grid-jitter: divide space into cells, one symbol per cell
	const cols = Math.ceil(Math.sqrt(count * 1.6)); // wider than tall
	const rows = Math.ceil(count / cols);
	const cellW = 100 / cols;
	const cellH = 100 / rows;

	// Size is in cqi (1cqi = 1% of container inline-size).
	// cellW is already in the same unit space (% of container width).
	// Cap symbol at 45% of cell width so it can never overlap neighbours.
	const maxSize = cellW * 0.45;
	const minSize = maxSize * 0.3;

	const result: SymbolData[] = [];

	for (let i = 0; i < count; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);

		const isLarge = rng() < 0.15;
		const size = isLarge
			? lerp(maxSize * 0.7, maxSize, rng())
			: lerp(minSize, maxSize * 0.7, rng());

		// Pad placement so the symbol centre stays away from cell edges.
		// Symbols extend ~size/2 from their origin; express as fraction of cell.
		const padX = (size / 2) / cellW + 0.05;
		const padY = (size / 2) / cellH + 0.05;

		const x = (col + padX + rng() * Math.max(0.01, 1 - 2 * padX)) * cellW;
		const y = (row + padY + rng() * Math.max(0.01, 1 - 2 * padY)) * cellH;

		const rotation = lerp(-30, 30, rng());
		const opacity = lerp(opacityRange[0], opacityRange[1], rng());

		result.push({
			char: symbols[Math.floor(rng() * symbols.length)]!,
			x,
			y,
			size,
			rotation,
			opacity,
			animDuration: lerp(6, 14, rng()),
			animDelay: lerp(0, 5, rng()),
		});
	}

	return result;
}

// ---------------------------------------------------------------------------
// CSS keyframes (injected once via <style>)
// ---------------------------------------------------------------------------
const STYLES = `
.cb-sym {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.cb-sym:hover {
  transform: var(--cb-base-transform) scale(1.6) !important;
  opacity: var(--cb-hover-opacity) !important;
}
@keyframes cb-float {
  0%, 100% { transform: var(--cb-base-transform) translateY(0); }
  25%      { transform: var(--cb-base-transform) translate(12px, -18px); }
  50%      { transform: var(--cb-base-transform) translate(-8px, -28px); }
  75%      { transform: var(--cb-base-transform) translate(-14px, -10px); }
}
@keyframes cb-pulse {
  0%, 100% { opacity: var(--cb-base-opacity); }
  50%      { opacity: calc(var(--cb-base-opacity) * 2.5); }
}
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
function CurrencyBackgroundInner({
	symbolSets,
	color,
	density,
	animation,
	opacity,
	seed,
}: CurrencyBackgroundProps) {
	const symbols = useMemo(() => {
		const pool = symbolSets.flatMap((set) => [...SYMBOL_SETS[set]]);
		if (pool.length === 0) return [];

		// Reduce density on mobile (~40% fewer). We read innerWidth at mount time;
		// SSR falls back to full count (symbols are CSS-hidden on very small screens
		// via the container being purely decorative).
		const baseCount = DENSITY_COUNT[density];
		const isMobile =
			typeof window !== "undefined" && window.innerWidth < 640;
		const count = isMobile ? Math.round(baseCount * 0.6) : baseCount;

		return generateSymbols(seed, pool, count, OPACITY_RANGE[opacity]);
	}, [symbolSets, density, opacity, seed]);

	const colorClass = COLOR_CLASS[color];
	const isFloat = animation === "float";
	const isPulse = animation === "pulse";

	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 overflow-hidden"
			style={{ containerType: "inline-size" }}
		>
			<style>{STYLES}</style>

			{symbols.map((s, i) => {
				const baseTransform = `rotate(${s.rotation}deg)`;
				const hoverOpacity = Math.min(s.opacity + 0.3, 1);
				const style: React.CSSProperties & Record<string, string | number> = {
					position: "absolute",
					left: `${s.x}%`,
					top: `${s.y}%`,
					fontSize: `${s.size}cqi`,
					opacity: s.opacity,
					lineHeight: 1,
					userSelect: "none",
					pointerEvents: "auto",
					"--cb-base-transform": baseTransform,
					"--cb-hover-opacity": hoverOpacity,
				};

				if (isFloat) {
					style.animation = `cb-float ${s.animDuration}s ease-in-out ${s.animDelay}s infinite`;
					style.willChange = "transform";
				} else if (isPulse) {
					style.transform = baseTransform;
					style["--cb-base-opacity"] = s.opacity;
					style.animation = `cb-pulse ${s.animDuration}s ease-in-out ${s.animDelay}s infinite`;
					style.willChange = "opacity";
				} else {
					style.transform = baseTransform;
				}

				return (
					<span
						className={`cb-sym ${colorClass}`}
						key={i}
						style={style}
					>
						{s.char}
					</span>
				);
			})}
		</div>
	);
}

export const CurrencyBackground = memo(CurrencyBackgroundInner);
