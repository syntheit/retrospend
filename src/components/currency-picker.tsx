"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { useSession } from "~/hooks/use-session";
import {
	CRYPTO_CURRENCIES,
	CURRENCIES,
	type CurrencyCode,
} from "~/lib/currencies";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface CurrencyPickerProps {
	value?: CurrencyCode;
	onValueChange: (value: CurrencyCode) => void;
	placeholder?: string;
}

export function CurrencyPicker({
	value,
	onValueChange,
	placeholder = "Select currency...",
}: CurrencyPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const { data: session } = useSession();

	const { data: favoriteCurrencyOrder = [] } =
		api.preferences.getFavoriteCurrencies.useQuery(undefined, {
			enabled: Boolean(session?.user),
		});

	const currencies = useMemo(() => {
		const allCurrencies = { ...CURRENCIES, ...CRYPTO_CURRENCIES };
		return Object.entries(allCurrencies).map(([code, currency]) => ({
			...currency,
			code: code as CurrencyCode,
		}));
	}, []);

	const filteredCurrencies = useMemo(() => {
		if (!search) return currencies;

		const searchLower = search.toLowerCase();
		return currencies.filter(
			(currency) =>
				currency.code.toLowerCase().includes(searchLower) ||
				currency.name.toLowerCase().includes(searchLower) ||
				currency.symbol.toLowerCase().includes(searchLower),
		);
	}, [currencies, search]);

	const selectedCurrency = useMemo(() => {
		if (!value) return null;
		return (
			CURRENCIES[value as keyof typeof CURRENCIES] ||
			CRYPTO_CURRENCIES[value as keyof typeof CRYPTO_CURRENCIES]
		);
	}, [value]);

	const favoriteRank = useMemo(() => {
		const rank = new Map<string, number>();
		favoriteCurrencyOrder.forEach((code, index) => {
			rank.set(code, index);
		});
		return rank;
	}, [favoriteCurrencyOrder]);

	const sortedCurrencies = useMemo(() => {
		if (!favoriteRank.size) {
			return filteredCurrencies;
		}

		const favorites: typeof filteredCurrencies = [];
		const others: typeof filteredCurrencies = [];

		filteredCurrencies.forEach((currency) => {
			if (favoriteRank.has(currency.code)) {
				favorites.push(currency);
			} else {
				others.push(currency);
			}
		});

		favorites.sort(
			(a, b) =>
				(favoriteRank.get(a.code) ?? 0) - (favoriteRank.get(b.code) ?? 0),
		);

		return [...favorites, ...others];
	}, [favoriteRank, filteredCurrencies]);

	const fiatCurrencies = useMemo(
		() => sortedCurrencies.filter((c) => c.code in CURRENCIES),
		[sortedCurrencies],
	);

	const cryptoCurrencies = useMemo(
		() => sortedCurrencies.filter((c) => c.code in CRYPTO_CURRENCIES),
		[sortedCurrencies],
	);

	const renderCurrencyItem = (currency: (typeof currencies)[0]) => (
		<div
			aria-selected={value === currency.code}
			className={cn(
				"flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent hover:text-accent-foreground",
				value === currency.code && "bg-accent text-accent-foreground",
			)}
			key={currency.code}
			onClick={() => {
				onValueChange(currency.code);
				setOpen(false);
				setSearch("");
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onValueChange(currency.code);
					setOpen(false);
					setSearch("");
				}
			}}
			role="option"
			tabIndex={0}
		>
			<Check
				className={cn(
					"h-4 w-4",
					value === currency.code ? "opacity-100" : "opacity-0",
				)}
			/>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="font-medium">{currency.symbol}</span>
				<span>{currency.code}</span>
				<span className="truncate text-muted-foreground">{currency.name}</span>
			</span>
		</div>
	);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-expanded={open}
					className="w-full justify-between"
					role="combobox"
					variant="outline"
				>
					{selectedCurrency ? (
						<span className="flex min-w-0 flex-1 items-center gap-2">
							<span className="font-medium">{selectedCurrency.symbol}</span>
							<span className="truncate text-muted-foreground">
								{selectedCurrency.code} - {selectedCurrency.name}
							</span>
						</span>
					) : (
						placeholder
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-full p-0">
				<div className="p-2">
					<Input
						className="mb-2"
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search currencies..."
						value={search}
					/>
				</div>
				<div
					className="max-h-64 overflow-y-auto"
					onWheel={(e) => e.stopPropagation()}
				>
					{sortedCurrencies.length === 0 ? (
						<div className="p-4 text-center text-muted-foreground">
							No currencies found.
						</div>
					) : (
						<>
							{fiatCurrencies.length > 0 && (
								<>{fiatCurrencies.map(renderCurrencyItem)}</>
							)}
							{cryptoCurrencies.length > 0 && (
								<>
									<div className="bg-muted/50 px-3 py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
										Cryptocurrency
									</div>
									{cryptoCurrencies.map(renderCurrencyItem)}
								</>
							)}
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
