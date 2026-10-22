/**
 * Gallery fixtures: the illustrated project covers of the mockup kit, drawn
 * from the category tokens so they follow the theme. They stand in for the
 * Cover component (photo or illustrated scene), which is not built yet;
 * only the gallery uses them.
 */
import type { ReactNode } from "react";

const mix = (n: number, pct: number) =>
	`color-mix(in oklab, var(--category-${n}) ${pct}%, var(--surface))`;

const S = {
	fill: (n: number, pct: number) => ({ style: { fill: mix(n, pct) } }),
};
const SURFACE = { style: { fill: "var(--surface)" } };

const SCENES: Record<string, ReactNode> = {
	sea: (
		<>
			<rect height="96" width="96" {...S.fill(20, 22)} />
			<circle cx="68" cy="30" r="12" {...S.fill(3, 90)} />
			<path
				d="M0 62 Q12 54 24 62 T48 62 T72 62 T96 62 V96 H0Z"
				{...S.fill(4, 70)}
			/>
			<path
				d="M0 76 Q12 68 24 76 T48 76 T72 76 T96 76 V96 H0Z"
				{...S.fill(12, 85)}
			/>
		</>
	),
	city: (
		<>
			<rect height="96" width="96" {...S.fill(11, 20)} />
			<rect height="56" width="22" x="8" y="40" {...S.fill(7, 75)} />
			<rect height="74" width="26" x="34" y="22" {...S.fill(9, 80)} />
			<rect height="48" width="24" x="64" y="48" {...S.fill(15, 75)} />
		</>
	),
	tiles: (
		<>
			<rect height="96" width="96" {...S.fill(21, 18)} />
			<rect height="38" width="38" x="8" y="8" {...S.fill(8, 80)} />
			<rect height="38" width="38" x="50" y="8" {...S.fill(16, 70)} />
			<rect height="38" width="38" x="8" y="50" {...S.fill(21, 65)} />
			<rect height="38" width="38" x="50" y="50" {...S.fill(8, 45)} />
		</>
	),
	grill: (
		<>
			<rect height="96" width="96" {...S.fill(6, 22)} />
			<circle cx="48" cy="40" r="22" {...S.fill(1, 80)} />
			<rect height="8" rx="4" width="68" x="14" y="58" {...S.fill(21, 70)} />
			<rect height="22" width="6" x="24" y="66" {...S.fill(21, 70)} />
			<rect height="22" width="6" x="66" y="66" {...S.fill(21, 70)} />
		</>
	),
	mountain: (
		<>
			<rect height="96" width="96" {...S.fill(20, 20)} />
			<circle cx="70" cy="26" r="10" {...S.fill(3, 85)} />
			<path d="M-6 96 L30 34 L52 66 L66 46 L102 96Z" {...S.fill(7, 72)} />
			<path d="M30 34 L39 50 L33 47 L27 52 L22 48Z" {...SURFACE} />
			<path d="M40 96 L72 52 L104 96Z" {...S.fill(16, 62)} />
		</>
	),
};

/** A kit cover scene by name, filling its slot. */
export function FixtureCover({ scene }: { scene: keyof typeof SCENES }) {
	return (
		<svg
			aria-hidden="true"
			preserveAspectRatio="xMidYMid slice"
			viewBox="0 0 96 96"
		>
			{SCENES[scene]}
		</svg>
	);
}
