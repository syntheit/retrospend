import {
	parsePhoneNumber,
	isValidPhoneNumber,
	type CountryCode,
} from "libphonenumber-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdentifierType =
	| "username"
	| "email"
	| "phone"
	| "email_or_phone"
	| "wallet_address"
	| "account_number"
	| "tag"
	| "custom"
	| "none";

export type PaymentMethodCategory = "p2p" | "bank" | "crypto" | "cash" | "regional";

export type CryptoNetworkDef = {
	id: string;
	name: string;
	shortName: string;
	feeLevel: "high" | "medium" | "low";
	popular: boolean;
};

export type PaymentMethodTypeDef = {
	id: string;
	name: string;
	icon: string | null;
	iconFallbackColor: string;
	currencies: string[];
	identifierType: IdentifierType;
	identifierLabel: string;
	identifierPlaceholder: string;
	identifierPrefix?: string;
	phoneCountryDefault?: string;
	regions: string[];
	category: PaymentMethodCategory;
	deepLinkTemplate?: string;
	networks?: CryptoNetworkDef[];
	defaultNetwork?: string;
};

// ─── Crypto Networks ──────────────────────────────────────────────────────────

export const CRYPTO_NETWORKS: CryptoNetworkDef[] = [
	{ id: "ethereum", name: "Ethereum (ERC-20)", shortName: "ERC-20", feeLevel: "high", popular: true },
	{ id: "polygon", name: "Polygon (PoS)", shortName: "Polygon", feeLevel: "low", popular: true },
	{ id: "tron", name: "Tron (TRC-20)", shortName: "TRC-20", feeLevel: "low", popular: true },
	{ id: "solana", name: "Solana (SPL)", shortName: "SPL", feeLevel: "low", popular: true },
	{ id: "bitcoin", name: "Bitcoin", shortName: "BTC", feeLevel: "medium", popular: true },
	{ id: "base", name: "Base", shortName: "Base", feeLevel: "low", popular: true },
	{ id: "arbitrum", name: "Arbitrum (One)", shortName: "Arbitrum", feeLevel: "low", popular: true },
	{ id: "optimism", name: "Optimism", shortName: "Optimism", feeLevel: "low", popular: false },
	{ id: "bsc", name: "BNB Smart Chain (BEP-20)", shortName: "BSC", feeLevel: "low", popular: false },
	{ id: "avalanche", name: "Avalanche (C-Chain)", shortName: "AVAX", feeLevel: "low", popular: false },
	{ id: "lightning", name: "Lightning Network", shortName: "Lightning", feeLevel: "low", popular: false },
];

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PAYMENT_METHOD_TYPES: PaymentMethodTypeDef[] = [

	// ── US ──────────────────────────────────────────────────────────────────────
	{
		id: "venmo",
		name: "Venmo",
		icon: "/images/payment-methods/venmo.svg",
		iconFallbackColor: "#3D95CE",
		currencies: ["USD"],
		identifierType: "username",
		identifierLabel: "Venmo username",
		identifierPlaceholder: "@username",
		identifierPrefix: "@",
		regions: ["US"],
		category: "p2p",
		deepLinkTemplate: "venmo://paycharge?txn=pay&recipients={id}&amount={amount}&note={note}",
	},
	{
		id: "zelle",
		name: "Zelle",
		icon: "/images/payment-methods/zelle.svg",
		iconFallbackColor: "#6D1ED4",
		currencies: ["USD"],
		identifierType: "email_or_phone",
		identifierLabel: "Email or phone",
		identifierPlaceholder: "you@email.com or +1...",
		regions: ["US"],
		category: "p2p",
	},
	{
		id: "cashapp",
		name: "Cash App",
		icon: "/images/payment-methods/cashapp.svg",
		iconFallbackColor: "#00D632",
		currencies: ["USD"],
		identifierType: "tag",
		identifierLabel: "Cashtag",
		identifierPlaceholder: "$username",
		identifierPrefix: "$",
		regions: ["US"],
		category: "p2p",
		deepLinkTemplate: "https://cash.app/{id}/{amount}",
	},
	{
		id: "applepay",
		name: "Apple Pay",
		icon: "/images/payment-methods/applepay.svg",
		iconFallbackColor: "#000000",
		currencies: ["USD"],
		identifierType: "email_or_phone",
		identifierLabel: "Apple Pay email or phone",
		identifierPlaceholder: "you@icloud.com or +1...",
		regions: ["US"],
		category: "p2p",
	},
	{
		id: "googlepay",
		name: "Google Pay",
		icon: "/images/payment-methods/googlepay.svg",
		iconFallbackColor: "#4285F4",
		currencies: ["USD"],
		identifierType: "email_or_phone",
		identifierLabel: "Email or phone",
		identifierPlaceholder: "you@gmail.com or +1...",
		regions: ["US"],
		category: "p2p",
	},
	{
		id: "chime",
		name: "Chime",
		icon: null,
		iconFallbackColor: "#00D54B",
		currencies: ["USD"],
		identifierType: "tag",
		identifierLabel: "Chime $tag",
		identifierPlaceholder: "$yourtag",
		identifierPrefix: "$",
		regions: ["US"],
		category: "p2p",
	},

	// ── Argentina ────────────────────────────────────────────────────────────────
	{
		id: "mercadopago_ar",
		name: "MercadoPago",
		icon: "/images/payment-methods/mercadopago.svg",
		iconFallbackColor: "#009EE3",
		currencies: ["ARS"],
		identifierType: "email_or_phone",
		identifierLabel: "Email, phone, or CVU",
		identifierPlaceholder: "you@email.com or CVU",
		phoneCountryDefault: "AR",
		regions: ["AR"],
		category: "regional",
	},
	{
		id: "uala",
		name: "Ualá",
		icon: null,
		iconFallbackColor: "#7B2BFC",
		currencies: ["ARS"],
		identifierType: "email_or_phone",
		identifierLabel: "Email or CVU",
		identifierPlaceholder: "you@email.com or CVU",
		regions: ["AR"],
		category: "regional",
	},
	{
		id: "brubank",
		name: "Brubank",
		icon: null,
		iconFallbackColor: "#6C28D6",
		currencies: ["ARS"],
		identifierType: "account_number",
		identifierLabel: "CBU/CVU",
		identifierPlaceholder: "0000000000000000000000",
		regions: ["AR"],
		category: "regional",
	},
	{
		id: "bna_plus",
		name: "BNA+",
		icon: null,
		iconFallbackColor: "#1A5276",
		currencies: ["ARS"],
		identifierType: "account_number",
		identifierLabel: "CBU/CVU",
		identifierPlaceholder: "0000000000000000000000",
		regions: ["AR"],
		category: "regional",
	},
	{
		id: "naranja_x",
		name: "Naranja X",
		icon: null,
		iconFallbackColor: "#FF6600",
		currencies: ["ARS"],
		identifierType: "email_or_phone",
		identifierLabel: "Email or phone",
		identifierPlaceholder: "you@email.com or +54...",
		phoneCountryDefault: "AR",
		regions: ["AR"],
		category: "regional",
	},

	// ── Brazil ────────────────────────────────────────────────────────────────────
	{
		id: "pix",
		name: "PIX",
		icon: null,
		iconFallbackColor: "#32BCAD",
		currencies: ["BRL"],
		identifierType: "email_or_phone",
		identifierLabel: "PIX key (phone, CPF, email, or random)",
		identifierPlaceholder: "+55 11 99999-0000 or CPF",
		phoneCountryDefault: "BR",
		regions: ["BR"],
		category: "regional",
	},
	{
		id: "nubank",
		name: "Nubank",
		icon: "/images/payment-methods/nubank.svg",
		iconFallbackColor: "#8A05BE",
		currencies: ["BRL"],
		identifierType: "email_or_phone",
		identifierLabel: "PIX key or email",
		identifierPlaceholder: "you@email.com",
		regions: ["BR"],
		category: "regional",
	},
	{
		id: "picpay",
		name: "PicPay",
		icon: null,
		iconFallbackColor: "#21C25E",
		currencies: ["BRL"],
		identifierType: "username",
		identifierLabel: "PicPay username",
		identifierPlaceholder: "@username",
		identifierPrefix: "@",
		regions: ["BR"],
		category: "regional",
	},
	{
		id: "mercadopago_br",
		name: "MercadoPago",
		icon: "/images/payment-methods/mercadopago.svg",
		iconFallbackColor: "#009EE3",
		currencies: ["BRL"],
		identifierType: "email_or_phone",
		identifierLabel: "Email or phone",
		identifierPlaceholder: "you@email.com",
		phoneCountryDefault: "BR",
		regions: ["BR"],
		category: "regional",
	},

	// ── Europe ────────────────────────────────────────────────────────────────────
	{
		id: "revolut",
		name: "Revolut",
		icon: "/images/payment-methods/revolut.svg",
		iconFallbackColor: "#0075EB",
		currencies: ["EUR", "GBP", "USD", "*"],
		identifierType: "username",
		identifierLabel: "Revolut @username",
		identifierPlaceholder: "@username",
		identifierPrefix: "@",
		regions: ["EU", "GB"],
		category: "p2p",
	},
	{
		id: "n26",
		name: "N26",
		icon: "/images/payment-methods/n26.svg",
		iconFallbackColor: "#36A18B",
		currencies: ["EUR"],
		identifierType: "email",
		identifierLabel: "Email",
		identifierPlaceholder: "you@email.com",
		regions: ["EU"],
		category: "bank",
	},
	{
		id: "bizum",
		name: "Bizum",
		icon: null,
		iconFallbackColor: "#00A5E0",
		currencies: ["EUR"],
		identifierType: "phone",
		identifierLabel: "Phone number",
		identifierPlaceholder: "+34 600 000 000",
		phoneCountryDefault: "ES",
		regions: ["ES"],
		category: "regional",
	},
	{
		id: "lydia",
		name: "Lydia",
		icon: null,
		iconFallbackColor: "#0070FF",
		currencies: ["EUR"],
		identifierType: "phone",
		identifierLabel: "Phone number",
		identifierPlaceholder: "+33 6 00 00 00 00",
		phoneCountryDefault: "FR",
		regions: ["FR"],
		category: "regional",
	},
	{
		id: "satispay",
		name: "Satispay",
		icon: null,
		iconFallbackColor: "#F24444",
		currencies: ["EUR"],
		identifierType: "phone",
		identifierLabel: "Phone number",
		identifierPlaceholder: "+39 300 000 0000",
		phoneCountryDefault: "IT",
		regions: ["IT"],
		category: "regional",
	},

	// ── Turkey ────────────────────────────────────────────────────────────────────
	{
		id: "papara",
		name: "Papara",
		icon: null,
		iconFallbackColor: "#7B2BFC",
		currencies: ["TRY"],
		identifierType: "phone",
		identifierLabel: "Phone number",
		identifierPlaceholder: "+90 500 000 0000",
		phoneCountryDefault: "TR",
		regions: ["TR"],
		category: "regional",
	},

	// ── Global ────────────────────────────────────────────────────────────────────
	{
		id: "paypal",
		name: "PayPal",
		icon: "/images/payment-methods/paypal.svg",
		iconFallbackColor: "#003087",
		currencies: ["*"],
		identifierType: "email",
		identifierLabel: "PayPal email",
		identifierPlaceholder: "you@email.com",
		regions: ["GLOBAL"],
		category: "p2p",
		deepLinkTemplate: "https://paypal.me/{id}/{amount}",
	},
	{
		id: "wise",
		name: "Wise",
		icon: "/images/payment-methods/wise.svg",
		iconFallbackColor: "#9FE870",
		currencies: ["*"],
		identifierType: "email",
		identifierLabel: "Wise email",
		identifierPlaceholder: "you@email.com",
		regions: ["GLOBAL"],
		category: "bank",
	},
	{
		id: "bank_transfer",
		name: "Bank Transfer",
		icon: null,
		iconFallbackColor: "#6B7280",
		currencies: ["*"],
		identifierType: "account_number",
		identifierLabel: "Account details",
		identifierPlaceholder: "IBAN, routing number, or account number",
		regions: ["GLOBAL"],
		category: "bank",
	},
	{
		id: "cash",
		name: "Cash",
		icon: null,
		iconFallbackColor: "#10B981",
		currencies: ["*"],
		identifierType: "none",
		identifierLabel: "",
		identifierPlaceholder: "",
		regions: ["GLOBAL"],
		category: "cash",
	},

	// ── Crypto ────────────────────────────────────────────────────────────────────
	{
		id: "crypto_btc",
		name: "Bitcoin (BTC)",
		icon: "/images/crypto/btc.svg",
		iconFallbackColor: "#F7931A",
		currencies: ["BTC"],
		identifierType: "wallet_address",
		identifierLabel: "Wallet address",
		identifierPlaceholder: "bc1q... or 1A1zP...",
		regions: ["GLOBAL"],
		category: "crypto",
		networks: [
			{ id: "bitcoin", name: "Bitcoin", shortName: "BTC", feeLevel: "medium", popular: true },
			{ id: "lightning", name: "Lightning Network", shortName: "Lightning", feeLevel: "low", popular: false },
		],
		defaultNetwork: "bitcoin",
	},
	{
		id: "crypto_eth",
		name: "Ethereum (ETH)",
		icon: "/images/crypto/eth.svg",
		iconFallbackColor: "#627EEA",
		currencies: ["ETH"],
		identifierType: "wallet_address",
		identifierLabel: "Wallet address",
		identifierPlaceholder: "0x...",
		regions: ["GLOBAL"],
		category: "crypto",
		networks: [
			{ id: "ethereum", name: "Ethereum", shortName: "ETH", feeLevel: "high", popular: true },
			{ id: "arbitrum", name: "Arbitrum", shortName: "Arbitrum", feeLevel: "low", popular: true },
			{ id: "base", name: "Base", shortName: "Base", feeLevel: "low", popular: true },
			{ id: "optimism", name: "Optimism", shortName: "Optimism", feeLevel: "low", popular: false },
		],
		defaultNetwork: "ethereum",
	},
	{
		id: "crypto_usdt",
		name: "Tether (USDT)",
		icon: "/images/crypto/usdt.svg",
		iconFallbackColor: "#26A17B",
		currencies: ["USDT"],
		identifierType: "wallet_address",
		identifierLabel: "Wallet address",
		identifierPlaceholder: "T... or 0x...",
		regions: ["GLOBAL"],
		category: "crypto",
		networks: [
			{ id: "tron", name: "Tron (TRC-20)", shortName: "TRC-20", feeLevel: "low", popular: true },
			{ id: "ethereum", name: "Ethereum (ERC-20)", shortName: "ERC-20", feeLevel: "high", popular: true },
			{ id: "solana", name: "Solana (SPL)", shortName: "SPL", feeLevel: "low", popular: true },
			{ id: "polygon", name: "Polygon", shortName: "Polygon", feeLevel: "low", popular: false },
			{ id: "bsc", name: "BNB Chain (BEP-20)", shortName: "BSC", feeLevel: "low", popular: false },
			{ id: "arbitrum", name: "Arbitrum", shortName: "Arbitrum", feeLevel: "low", popular: false },
		],
		defaultNetwork: "tron",
	},
	{
		id: "crypto_usdc",
		name: "USD Coin (USDC)",
		icon: "/images/crypto/usdc.svg",
		iconFallbackColor: "#2775CA",
		currencies: ["USDC"],
		identifierType: "wallet_address",
		identifierLabel: "Wallet address",
		identifierPlaceholder: "0x... or ...",
		regions: ["GLOBAL"],
		category: "crypto",
		networks: [
			{ id: "solana", name: "Solana (SPL)", shortName: "SPL", feeLevel: "low", popular: true },
			{ id: "base", name: "Base", shortName: "Base", feeLevel: "low", popular: true },
			{ id: "ethereum", name: "Ethereum (ERC-20)", shortName: "ERC-20", feeLevel: "high", popular: true },
			{ id: "polygon", name: "Polygon", shortName: "Polygon", feeLevel: "low", popular: false },
			{ id: "arbitrum", name: "Arbitrum", shortName: "Arbitrum", feeLevel: "low", popular: false },
		],
		defaultNetwork: "solana",
	},
	{
		id: "crypto_sol",
		name: "Solana (SOL)",
		icon: "/images/crypto/sol.svg",
		iconFallbackColor: "#9945FF",
		currencies: ["SOL"],
		identifierType: "wallet_address",
		identifierLabel: "Wallet address",
		identifierPlaceholder: "...",
		regions: ["GLOBAL"],
		category: "crypto",
		networks: [
			{ id: "solana", name: "Solana", shortName: "SOL", feeLevel: "low", popular: true },
		],
		defaultNetwork: "solana",
	},

	// ── Custom fallback ───────────────────────────────────────────────────────────
	{
		id: "custom",
		name: "Custom",
		icon: null,
		iconFallbackColor: "#6B7280",
		currencies: ["*"],
		identifierType: "custom",
		identifierLabel: "Details",
		identifierPlaceholder: "Enter payment details",
		regions: ["GLOBAL"],
		category: "p2p",
	},
];

// ─── Currency-to-region mapping ───────────────────────────────────────────────

const CURRENCY_REGIONS: Record<string, string[]> = {
	USD: ["US"],
	ARS: ["AR"],
	BRL: ["BR"],
	EUR: ["EU", "ES", "FR", "IT"],
	GBP: ["GB"],
	TRY: ["TR"],
	JPY: ["JP"],
	CAD: ["CA"],
	AUD: ["AU"],
	MXN: ["MX"],
	CLP: ["CL"],
	COP: ["CO"],
	PEN: ["PE"],
	UYU: ["UY"],
	PYG: ["PY"],
	BOB: ["BO"],
	// Spain/France/Italy/etc. are all EUR - handled by EU
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function getMethodType(id: string): PaymentMethodTypeDef | undefined {
	return PAYMENT_METHOD_TYPES.find((m) => m.id === id);
}

export function getMethodIcon(id: string): {
	src: string | null;
	fallbackColor: string;
	fallbackLetter: string;
} {
	const def = getMethodType(id);
	if (!def) {
		return { src: null, fallbackColor: "#6B7280", fallbackLetter: "?" };
	}
	return {
		src: def.icon,
		fallbackColor: def.iconFallbackColor,
		fallbackLetter: def.name.charAt(0).toUpperCase(),
	};
}

export function getMethodsByRegion(userCurrency: string): {
	regional: PaymentMethodTypeDef[];
	global: PaymentMethodTypeDef[];
	crypto: PaymentMethodTypeDef[];
	other: PaymentMethodTypeDef[];
} {
	const userRegions = CURRENCY_REGIONS[userCurrency.toUpperCase()] ?? [];

	const regional: PaymentMethodTypeDef[] = [];
	const global: PaymentMethodTypeDef[] = [];
	const crypto: PaymentMethodTypeDef[] = [];
	const other: PaymentMethodTypeDef[] = [];

	for (const m of PAYMENT_METHOD_TYPES) {
		if (m.category === "crypto") {
			crypto.push(m);
		} else if (m.regions.includes("GLOBAL")) {
			global.push(m);
		} else if (m.regions.some((r) => userRegions.includes(r))) {
			regional.push(m);
		} else {
			other.push(m);
		}
	}

	return { regional, global, crypto, other };
}

export function getIdentifierConfig(typeId: string): {
	type: IdentifierType;
	label: string;
	placeholder: string;
	prefix?: string;
	phoneCountry?: string;
} {
	const def = getMethodType(typeId);
	if (!def) {
		return {
			type: "custom",
			label: "Details",
			placeholder: "Enter payment details",
		};
	}
	return {
		type: def.identifierType,
		label: def.identifierLabel,
		placeholder: def.identifierPlaceholder,
		prefix: def.identifierPrefix,
		phoneCountry: def.phoneCountryDefault,
	};
}

const FEE_LEVEL_ORDER: Record<CryptoNetworkDef["feeLevel"], number> = {
	low: 0,
	medium: 1,
	high: 2,
};

export function getNetworksForType(typeId: string): CryptoNetworkDef[] {
	const def = getMethodType(typeId);
	if (!def?.networks) return [];

	return [...def.networks].sort((a, b) => {
		// fee level ascending first (low → medium → high), popular as tiebreaker
		const feeDiff = FEE_LEVEL_ORDER[a.feeLevel] - FEE_LEVEL_ORDER[b.feeLevel];
		if (feeDiff !== 0) return feeDiff;
		return a.popular === b.popular ? 0 : a.popular ? -1 : 1;
	});
}

export function getCurrencyForType(typeId: string): string | null {
	const def = getMethodType(typeId);
	if (!def) return null;
	if (def.currencies.length === 1 && def.currencies[0] !== "*") {
		return def.currencies[0]!;
	}
	return null;
}

export function formatPhoneForDisplay(
	phone: string,
	countryDefault?: string,
): string {
	const country = (countryDefault as CountryCode | undefined) ?? undefined;
	// Try as-is first, then with a leading + (for bare national numbers like '11999887766')
	const candidates = [phone, phone.startsWith("+") ? null : `+${phone}`];
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			const parsed = parsePhoneNumber(candidate, country);
			if (parsed?.isValid()) {
				return parsed.formatInternational();
			}
		} catch {
			// try next
		}
	}
	// If country given, try treating the entire string as a national number
	if (country) {
		try {
			const parsed = parsePhoneNumber(phone, country);
			if (parsed) return parsed.formatInternational();
		} catch {
			// fall through
		}
	}
	return phone;
}

export function validateIdentifier(
	value: string,
	typeId: string,
): { valid: boolean; formatted?: string; error?: string } {
	const def = getMethodType(typeId);
	const identifierType = def?.identifierType ?? "custom";

	switch (identifierType) {
		case "phone": {
			const country = (def?.phoneCountryDefault as CountryCode | undefined) ?? undefined;
			try {
				if (isValidPhoneNumber(value, country)) {
					const parsed = parsePhoneNumber(value, country);
					return { valid: true, formatted: parsed?.formatInternational() ?? value };
				}
			} catch {
				// fall through
			}
			return { valid: false, error: "Invalid phone number" };
		}

		case "email": {
			const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (emailRe.test(value)) return { valid: true, formatted: value.trim().toLowerCase() };
			return { valid: false, error: "Invalid email address" };
		}

		case "email_or_phone": {
			const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (emailRe.test(value)) return { valid: true, formatted: value.trim().toLowerCase() };
			const country = (def?.phoneCountryDefault as CountryCode | undefined) ?? undefined;
			try {
				if (isValidPhoneNumber(value, country)) {
					const parsed = parsePhoneNumber(value, country);
					return { valid: true, formatted: parsed?.formatInternational() ?? value };
				}
			} catch {
				// fall through
			}
			// also allow CVU/CBU (22-digit numeric) for MercadoPago etc.
			if (/^\d{22}$/.test(value)) return { valid: true, formatted: value };
			return { valid: false, error: "Invalid email or phone number" };
		}

		case "username": {
			const stripped = value.startsWith("@") ? value.slice(1) : value;
			if (/\s/.test(stripped)) return { valid: false, error: "Username cannot contain spaces" };
			if (!stripped) return { valid: false, error: "Username is required" };
			return { valid: true, formatted: stripped };
		}

		case "tag": {
			const prefix = def?.identifierPrefix ?? "";
			const stripped = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
			if (/\s/.test(stripped)) return { valid: false, error: "Tag cannot contain spaces" };
			if (!stripped) return { valid: false, error: "Tag is required" };
			return { valid: true, formatted: stripped };
		}

		case "wallet_address": {
			const trimmed = value.trim();
			// Basic sanity: hex (EVM / BTC legacy), bech32 (bc1/tb1), base58, base58check, Solana base58
			const isHex = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
			const isBech32 = /^(bc1|tb1)[a-z0-9]{25,90}$/.test(trimmed);
			const isTron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed);
			const isBase58 = /^[1-9A-HJ-NP-Za-km-z]{25,58}$/.test(trimmed);
			if (isHex || isBech32 || isTron || isBase58) {
				return { valid: true, formatted: trimmed };
			}
			return { valid: false, error: "Invalid wallet address" };
		}

		case "account_number": {
			const trimmed = value.trim();
			if (!trimmed) return { valid: false, error: "Account number is required" };
			return { valid: true, formatted: trimmed };
		}

		case "none":
		case "custom":
		default:
			return { valid: true, formatted: value };
	}
}

// ─── Backward Compatibility ───────────────────────────────────────────────────

/**
 * Maps old DB type values to new registry IDs.
 * The old DB stored crypto methods as type='crypto' with a separate currency field.
 * New methods use 'crypto_btc', 'crypto_eth', etc.
 * Use this when READING existing payment methods - never modify DB records.
 */
export function resolveMethodTypeId(
	type: string,
	currency?: string | null,
): string {
	if (type === "crypto" && currency) {
		return `crypto_${currency.toLowerCase()}`;
	}
	return type;
}
