"use client";

import { ArrowUpDown } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { CurrencyPicker } from "~/components/currency-picker";
import { Button } from "~/components/ui/button";
import { Chip } from "~/components/ui/chip";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { useCurrencyCalculator } from "~/hooks/use-currency-calculator";
import type { CurrencyCode } from "~/lib/currencies";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";

interface CurrencyCalculatorProps {
	homeCurrency: string;
	defaultCurrency: string;
	externalCurrency?: string | null;
}

export const CurrencyCalculator = forwardRef<
	HTMLDivElement,
	CurrencyCalculatorProps
>(function CurrencyCalculator(
	{ homeCurrency, defaultCurrency, externalCurrency },
	ref,
) {
	const calc = useCurrencyCalculator({
		homeCurrency,
		defaultCurrency,
		externalCurrency,
	});

	return (
		<Card ref={ref}>
			<CardContent className="space-y-0 p-4">
				{/* Top row */}
				<div className="flex items-center gap-3">
					<CurrencyPicker
						onValueChange={(v) =>
							calc.handleTopCurrencyChange(v as string)
						}
						triggerClassName="shrink-0 w-28"
						triggerDisplay="flag+code"
						triggerVariant="outline"
						value={calc.topCurrency as CurrencyCode}
					/>
					<Input
						className="flex-1 text-right tabular-nums text-lg"
						inputMode="decimal"
						onChange={(e) => calc.handleTopAmountChange(e.target.value)}
						placeholder="0.00"
						type="text"
						value={calc.topAmount}
					/>
				</div>

				{/* Divider with rate strip or pill + swap */}
				<div className="relative flex items-center py-3">
					<div className="flex-1 flex items-center min-h-7 min-w-0 pr-10">
						{calc.stripRateOptions.length > 1 ? (
							<CalculatorRateStrip
								onSelect={calc.handleRateTypeChange}
								options={calc.stripRateOptions}
								selectedType={calc.selectedRateType}
							/>
						) : calc.displayRate ? (
							<div className="flex justify-center">
								<span className="rounded-full bg-muted/60 px-3 py-1 text-muted-foreground text-sm tabular-nums">
									1 {calc.topCurrency} ={" "}
									{calc.displayRate.toLocaleString(undefined, {
										minimumFractionDigits: 2,
										maximumFractionDigits: 6,
									})}{" "}
									{calc.bottomCurrency}
								</span>
							</div>
						) : (
							<div className="w-full border-t border-border" />
						)}
					</div>
					<Button
						aria-label="Swap currencies"
						className="absolute right-0 h-8 w-8 rounded-full"
						onClick={calc.swap}
						size="icon"
						variant="outline"
					>
						<ArrowUpDown className="h-4 w-4" />
					</Button>
				</div>

				{/* Bottom row */}
				<div className="flex items-center gap-3">
					<CurrencyPicker
						onValueChange={(v) =>
							calc.handleBottomCurrencyChange(v as string)
						}
						triggerClassName="shrink-0 w-28"
						triggerDisplay="flag+code"
						triggerVariant="outline"
						value={calc.bottomCurrency as CurrencyCode}
					/>
					<Input
						className="flex-1 text-right tabular-nums text-lg"
						inputMode="decimal"
						onChange={(e) => calc.handleBottomAmountChange(e.target.value)}
						placeholder="0.00"
						type="text"
						value={calc.bottomAmount}
					/>
				</div>
			</CardContent>
		</Card>
	);
});

interface CalculatorRateStripProps {
	options: { type: string; rate: number; label: string }[];
	selectedType: string | null;
	onSelect: (type: string) => void;
}

function CalculatorRateStrip({
	options,
	selectedType,
	onSelect,
}: CalculatorRateStripProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollTarget = useRef(0);
	const scrollRaf = useRef<number>(0);
	const [showFade, setShowFade] = useState(false);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const checkFade = () => {
			setShowFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
		};

		checkFade();
		el.addEventListener("scroll", checkFade);
		const observer = new ResizeObserver(checkFade);
		observer.observe(el);

		return () => {
			el.removeEventListener("scroll", checkFade);
			observer.disconnect();
		};
	}, [options]);

	const handleWheel = useCallback((e: React.WheelEvent) => {
		const el = scrollRef.current;
		if (!el || el.scrollWidth <= el.clientWidth) return;
		e.preventDefault();
		scrollTarget.current = Math.max(
			0,
			Math.min(
				el.scrollWidth - el.clientWidth,
				(scrollRaf.current ? scrollTarget.current : el.scrollLeft) + e.deltaY,
			),
		);
		if (scrollRaf.current) return;
		const animate = () => {
			const current = el.scrollLeft;
			const target = scrollTarget.current;
			const diff = target - current;
			if (Math.abs(diff) < 0.5) {
				el.scrollLeft = target;
				scrollRaf.current = 0;
				return;
			}
			el.scrollLeft = current + diff * 0.25;
			scrollRaf.current = requestAnimationFrame(animate);
		};
		scrollRaf.current = requestAnimationFrame(animate);
	}, []);

	return (
		<div className="relative min-w-0 flex-1">
			<div
				ref={scrollRef}
				className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				onWheel={handleWheel}
			>
				{options.map((option) => {
					const isSelected = selectedType === option.type;
					return (
						<Chip
							active={isSelected}
							className="shrink-0"
							key={option.type}
							onClick={() => onSelect(option.type)}
						>
							{getRateTypeLabel(option.type)}
						</Chip>
					);
				})}
			</div>
			{showFade && (
				<div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent" />
			)}
		</div>
	);
}
