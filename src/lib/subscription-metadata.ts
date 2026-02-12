/**
 * Subscription brand metadata for pre-filling recurring template fields
 */

interface SubscriptionMetadata {
	url: string;
	icon?: string;
}

const SUBSCRIPTION_METADATA: Record<string, SubscriptionMetadata> = {
	netflix: { url: "https://netflix.com/account", icon: "netflix" },
	spotify: { url: "https://spotify.com/account", icon: "spotify" },
	youtube: { url: "https://youtube.com/paid_memberships", icon: "youtube" },
	"youtube premium": {
		url: "https://youtube.com/paid_memberships",
		icon: "youtube",
	},
	"youtube music": {
		url: "https://youtube.com/paid_memberships",
		icon: "youtube",
	},
	adobe: { url: "https://account.adobe.com/plans", icon: "adobe" },
	"creative cloud": { url: "https://account.adobe.com/plans", icon: "adobe" },
	aws: { url: "https://console.aws.amazon.com/billing", icon: "aws" },
	"amazon web services": {
		url: "https://console.aws.amazon.com/billing",
		icon: "aws",
	},
	github: { url: "https://github.com/settings/billing", icon: "github" },
	notion: { url: "https://notion.so/my-account", icon: "notion" },
	figma: { url: "https://figma.com/billing", icon: "figma" },
	slack: { url: "https://slack.com/account/billing", icon: "slack" },
	discord: { url: "https://discord.com/billing", icon: "discord" },
	"discord nitro": { url: "https://discord.com/billing", icon: "discord" },
	dropbox: { url: "https://dropbox.com/account/plan", icon: "dropbox" },
	icloud: { url: "https://www.icloud.com/settings/", icon: "apple" },
	apple: { url: "https://reportaproblem.apple.com/", icon: "apple" },
	"apple music": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	"apple tv": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	"apple one": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	hbo: { url: "https://www.max.com/account", icon: "hbo" },
	max: { url: "https://www.max.com/account", icon: "hbo" },
	disney: { url: "https://www.disneyplus.com/account", icon: "disney" },
	"disney+": { url: "https://www.disneyplus.com/account", icon: "disney" },
	hulu: { url: "https://www.hulu.com/account", icon: "hulu" },
	"amazon prime": {
		url: "https://www.amazon.com/gp/primecentral",
		icon: "amazon",
	},
	prime: { url: "https://www.amazon.com/gp/primecentral", icon: "amazon" },
	twitch: { url: "https://www.twitch.tv/subscriptions", icon: "twitch" },
	linkedin: {
		url: "https://www.linkedin.com/mypreferences/d/manage-subscription",
		icon: "linkedin",
	},
	microsoft: {
		url: "https://account.microsoft.com/services",
		icon: "microsoft",
	},
	"microsoft 365": {
		url: "https://account.microsoft.com/services",
		icon: "microsoft",
	},
	office: { url: "https://account.microsoft.com/services", icon: "microsoft" },
	xbox: { url: "https://account.microsoft.com/services", icon: "xbox" },
	"xbox game pass": {
		url: "https://account.microsoft.com/services",
		icon: "xbox",
	},
	playstation: {
		url: "https://www.playstation.com/en-us/playstation-plus/",
		icon: "playstation",
	},
	"ps plus": {
		url: "https://www.playstation.com/en-us/playstation-plus/",
		icon: "playstation",
	},
	nintendo: {
		url: "https://ec.nintendo.com/my/transactions",
		icon: "nintendo",
	},
	zoom: { url: "https://zoom.us/account", icon: "zoom" },
	"1password": {
		url: "https://my.1password.com/subscription",
		icon: "1password",
	},
	lastpass: { url: "https://lastpass.com/account", icon: "lastpass" },
	bitwarden: {
		url: "https://vault.bitwarden.com/#/settings/subscription",
		icon: "bitwarden",
	},
	nordvpn: {
		url: "https://my.nordaccount.com/dashboard/nordvpn/",
		icon: "nordvpn",
	},
	expressvpn: {
		url: "https://www.expressvpn.com/subscriptions",
		icon: "expressvpn",
	},
	canva: { url: "https://www.canva.com/settings/billing", icon: "canva" },
	grammarly: {
		url: "https://account.grammarly.com/subscription",
		icon: "grammarly",
	},
	openai: {
		url: "https://platform.openai.com/account/billing",
		icon: "openai",
	},
	chatgpt: {
		url: "https://chat.openai.com/settings/subscription",
		icon: "openai",
	},
	anthropic: {
		url: "https://console.anthropic.com/settings/billing",
		icon: "anthropic",
	},
	claude: { url: "https://claude.ai/settings/billing", icon: "anthropic" },
	vercel: { url: "https://vercel.com/account/billing", icon: "vercel" },
	netlify: {
		url: "https://app.netlify.com/user/settings#billing",
		icon: "netlify",
	},
	heroku: {
		url: "https://dashboard.heroku.com/account/billing",
		icon: "heroku",
	},
	digitalocean: {
		url: "https://cloud.digitalocean.com/account/billing",
		icon: "digitalocean",
	},
	cloudflare: {
		url: "https://dash.cloudflare.com/?to=/:account/billing",
		icon: "cloudflare",
	},
} as const;

/**
 * Get subscription metadata (URL and icon) for a subscription name.
 * Matches based on partial name inclusion (case-insensitive).
 *
 * @param name - The subscription name to look up
 * @returns SubscriptionMetadata if found, null otherwise
 */
export function getSubscriptionMetadata(
	name: string,
): SubscriptionMetadata | null {
	const normalized = name.toLowerCase().trim();

	// Check for exact match first
	if (SUBSCRIPTION_METADATA[normalized]) {
		return SUBSCRIPTION_METADATA[normalized];
	}

	// Then check for partial matches
	for (const [key, metadata] of Object.entries(SUBSCRIPTION_METADATA)) {
		if (normalized.includes(key) || key.includes(normalized)) {
			return metadata;
		}
	}

	return null;
}

/**
 * Get all known subscription brand names for autocomplete suggestions
 */
export function getKnownSubscriptionNames(): string[] {
	return Object.keys(SUBSCRIPTION_METADATA).map(
		(name) => name.charAt(0).toUpperCase() + name.slice(1),
	);
}
