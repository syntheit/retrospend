"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Chip } from "~/components/ui/chip";
import { CurrencyBackground } from "~/components/currency-background";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";
import { type BackgroundSettings, defaultBackgroundSettings } from "~/lib/background-settings";
import { useSession } from "~/hooks/use-session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SymbolSet = BackgroundSettings["symbolSets"][number];
type Color = BackgroundSettings["color"];
type Density = BackgroundSettings["density"];
type Animation = BackgroundSettings["animation"];
type Opacity = BackgroundSettings["opacity"];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SYMBOL_SET_OPTIONS: { value: SymbolSet; label: string; examples: string }[] = [
	{ value: "currency", label: "Currency", examples: "$ € £ ¥" },
	{ value: "math", label: "Math", examples: "+ − × ÷ %" },
	{ value: "finance", label: "Finance", examples: "# @ & ¢" },
];

const COLOR_OPTIONS: { value: Color; label: string; bg: string }[] = [
	{ value: "gray", label: "Gray", bg: "bg-neutral-400 dark:bg-neutral-500" },
	{ value: "green", label: "Green", bg: "bg-emerald-500" },
	{ value: "blue", label: "Blue", bg: "bg-blue-500" },
	{ value: "purple", label: "Purple", bg: "bg-purple-500" },
	{ value: "orange", label: "Orange", bg: "bg-orange-500" },
	{ value: "gold", label: "Gold", bg: "bg-yellow-500" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
	{ value: "sparse", label: "Sparse" },
	{ value: "medium", label: "Medium" },
	{ value: "dense", label: "Dense" },
];

const ANIMATION_OPTIONS: { value: Animation; label: string }[] = [
	{ value: "pulse", label: "Pulse" },
	{ value: "float", label: "Float" },
	{ value: "static", label: "Static" },
];

const OPACITY_OPTIONS: { value: Opacity; label: string }[] = [
	{ value: "subtle", label: "Subtle" },
	{ value: "medium", label: "Medium" },
	{ value: "bold", label: "Bold" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<span className="w-20 shrink-0 text-muted-foreground text-xs">{label}</span>
			<div className="flex flex-wrap gap-1.5">{children}</div>
		</div>
	);
}

function ToggleChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Chip active={active} onClick={onClick}>
			{children}
		</Chip>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function BackgroundCustomizationCard() {
	const { data: session } = useSession();
	const username = (session?.user as { username?: string } | undefined)?.username ?? "preview";

	const { data: savedSettings } = api.profile.getBackgroundSettings.useQuery();
	const saveMutation = api.profile.saveBackgroundSettings.useMutation({
		onError: () => toast.error("Failed to save background settings"),
	});

	const [settings, setSettings] = useState<BackgroundSettings>(defaultBackgroundSettings);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const initializedRef = useRef(false);

	// Hydrate from server once loaded
	useEffect(() => {
		if (savedSettings && !initializedRef.current) {
			initializedRef.current = true;
			setSettings(savedSettings);
		}
	}, [savedSettings]);

	const triggerSave = useCallback(
		(next: BackgroundSettings) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			setSaveState("saving");
			debounceRef.current = setTimeout(() => {
				saveMutation.mutate(next, {
					onSuccess: () => {
						setSaveState("saved");
						setTimeout(() => setSaveState("idle"), 2000);
					},
					onError: () => setSaveState("idle"),
				});
			}, 500);
		},
		[saveMutation],
	);

	const update = useCallback(
		(patch: Partial<BackgroundSettings>) => {
			setSettings((prev) => {
				const next = { ...prev, ...patch };
				triggerSave(next);
				return next;
			});
		},
		[triggerSave],
	);

	const toggleSymbolSet = useCallback(
		(set: SymbolSet) => {
			setSettings((prev) => {
				const current = prev.symbolSets;
				const already = current.includes(set);
				// Prevent deselecting the last one
				if (already && current.length === 1) return prev;
				const next: BackgroundSettings = {
					...prev,
					symbolSets: already
						? current.filter((s) => s !== set)
						: [...current, set],
				};
				triggerSave(next);
				return next;
			});
		},
		[triggerSave],
	);

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Profile Background</CardTitle>
						<CardDescription>
							Customize the animated background on your public profile.
						</CardDescription>
					</div>
					{saveState === "saving" && (
						<span className="text-muted-foreground text-xs">Saving...</span>
					)}
					{saveState === "saved" && (
						<span className="text-emerald-600 text-xs dark:text-emerald-400">Saved</span>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-5">
				{/* Live preview */}
				<div className="relative h-44 overflow-hidden rounded-lg border bg-background">
					<CurrencyBackground
						animation={settings.animation}
						color={settings.color}
						density={settings.density}
						opacity={settings.opacity}
						seed={username}
						symbolSets={settings.symbolSets}
					/>
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
						<span className="rounded-full border bg-card/80 px-3 py-1 font-medium text-muted-foreground text-xs backdrop-blur-sm">
							Preview
						</span>
					</div>
				</div>

				{/* Symbol sets */}
				<OptionRow label="Symbols">
					{SYMBOL_SET_OPTIONS.map(({ value, label, examples }) => (
						<ToggleChip
							active={settings.symbolSets.includes(value)}
							key={value}
							onClick={() => toggleSymbolSet(value)}
						>
							{label}{" "}
							<span className="ml-1 opacity-60">{examples}</span>
						</ToggleChip>
					))}
				</OptionRow>

				{/* Color swatches */}
				<div className="flex flex-wrap items-center gap-3">
					<span className="w-20 shrink-0 text-muted-foreground text-xs">Color</span>
					<div className="flex flex-wrap gap-2">
						{COLOR_OPTIONS.map(({ value, label, bg }) => (
							<button
								aria-label={label}
								className={`h-7 w-7 cursor-pointer rounded-full p-0 transition-all ${bg} ${
									settings.color === value
										? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
										: "hover:scale-105 opacity-80 hover:opacity-100"
								}`}
								key={value}
								onClick={() => update({ color: value })}
								title={label}
								type="button"
							/>
						))}
					</div>
				</div>

				{/* Density */}
				<OptionRow label="Density">
					{DENSITY_OPTIONS.map(({ value, label }) => (
						<ToggleChip
							active={settings.density === value}
							key={value}
							onClick={() => update({ density: value })}
						>
							{label}
						</ToggleChip>
					))}
				</OptionRow>

				{/* Animation */}
				<OptionRow label="Animation">
					{ANIMATION_OPTIONS.map(({ value, label }) => (
						<ToggleChip
							active={settings.animation === value}
							key={value}
							onClick={() => update({ animation: value })}
						>
							{label}
						</ToggleChip>
					))}
				</OptionRow>

				{/* Opacity */}
				<OptionRow label="Opacity">
					{OPACITY_OPTIONS.map(({ value, label }) => (
						<ToggleChip
							active={settings.opacity === value}
							key={value}
							onClick={() => update({ opacity: value })}
						>
							{label}
						</ToggleChip>
					))}
				</OptionRow>
			</CardContent>
		</Card>
	);
}
