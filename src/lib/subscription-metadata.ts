/**
 * Subscription brand metadata for pre-filling recurring template fields
 */

interface SubscriptionMetadata {
	url: string;
	icon?: string;
}

const SUBSCRIPTION_METADATA: Record<string, SubscriptionMetadata> = {
	// Streaming & Entertainment
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
	twitch: { url: "https://www.twitch.tv/subscriptions", icon: "twitch" },
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
	"apple music": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	"apple tv": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	"apple one": { url: "https://reportaproblem.apple.com/", icon: "apple" },
	tidal: { url: "https://account.tidal.com/subscription", icon: "tidal" },
	deezer: {
		url: "https://www.deezer.com/account/subscription",
		icon: "deezer",
	},
	audible: {
		url: "https://www.amazon.com/hz/audible/account/plan",
		icon: "audible",
	},
	"kindle unlimited": {
		url: "https://www.amazon.com/kindle-dbs/hz/my-items",
		icon: "amazon",
	},

	// Productivity & Design
	adobe: { url: "https://account.adobe.com/plans", icon: "adobe" },
	"creative cloud": { url: "https://account.adobe.com/plans", icon: "adobe" },
	notion: { url: "https://notion.so/my-account", icon: "notion" },
	figma: { url: "https://figma.com/billing", icon: "figma" },
	canva: { url: "https://www.canva.com/settings/billing", icon: "canva" },
	framer: { url: "https://framer.com/settings/billing", icon: "framer" },
	webflow: {
		url: "https://webflow.com/dashboard/account/billing",
		icon: "webflow",
	},
	midjourney: {
		url: "https://www.midjourney.com/account/",
		icon: "midjourney",
	},
	slack: { url: "https://slack.com/account/billing", icon: "slack" },
	discord: { url: "https://discord.com/billing", icon: "discord" },
	"discord nitro": { url: "https://discord.com/billing", icon: "discord" },
	dropbox: { url: "https://dropbox.com/account/plan", icon: "dropbox" },
	icloud: { url: "https://www.icloud.com/settings/", icon: "apple" },
	apple: { url: "https://reportaproblem.apple.com/", icon: "apple" },
	microsoft: {
		url: "https://account.microsoft.com/services",
		icon: "microsoft",
	},
	"microsoft 365": {
		url: "https://account.microsoft.com/services",
		icon: "microsoft",
	},
	office: { url: "https://account.microsoft.com/services", icon: "microsoft" },
	grammarly: {
		url: "https://account.grammarly.com/subscription",
		icon: "grammarly",
	},
	"1password": {
		url: "https://my.1password.com/subscription",
		icon: "1password",
	},
	lastpass: { url: "https://lastpass.com/account", icon: "lastpass" },
	bitwarden: {
		url: "https://vault.bitwarden.com/#/settings/subscription",
		icon: "bitwarden",
	},

	// News & Journalism
	"new york times": {
		url: "https://www.nytimes.com/subscription/account",
		icon: "nyt",
	},
	nyt: { url: "https://www.nytimes.com/subscription/account", icon: "nyt" },
	"wall street journal": {
		url: "https://customercenter.wsj.com/billing",
		icon: "wsj",
	},
	wsj: { url: "https://customercenter.wsj.com/billing", icon: "wsj" },
	bloomberg: {
		url: "https://www.bloomberg.com/profile/settings",
		icon: "bloomberg",
	},
	"washington post": {
		url: "https://www.washingtonpost.com/settings/subscription",
		icon: "washingtonpost",
	},
	"the atlantic": {
		url: "https://www.theatlantic.com/account/subscription/",
		icon: "theatlantic",
	},
	"the guardian": {
		url: "https://manage.theguardian.com/subscriptions",
		icon: "guardian",
	},
	medium: { url: "https://medium.com/me/settings/membership", icon: "medium" },
	substack: { url: "https://substack.com/settings", icon: "substack" },
	patreon: { url: "https://www.patreon.com/settings/billing", icon: "patreon" },

	// Dev & SaaS
	github: { url: "https://github.com/settings/billing", icon: "github" },
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
	aws: { url: "https://console.aws.amazon.com/billing", icon: "aws" },
	"amazon web services": {
		url: "https://console.aws.amazon.com/billing",
		icon: "aws",
	},
	supabase: {
		url: "https://supabase.com/dashboard/project/_/settings/billing",
		icon: "supabase",
	},
	railway: { url: "https://railway.app/account/billing", icon: "railway" },
	"fly.io": { url: "https://fly.io/dashboard/billing", icon: "flyio" },
	postman: { url: "https://go.postman.co/billing", icon: "postman" },
	datadog: { url: "https://app.datadoghq.com/billing", icon: "datadog" },
	sentry: { url: "https://sentry.io/settings/billing/", icon: "sentry" },
	zapier: { url: "https://zapier.com/app/billing", icon: "zapier" },
	mailchimp: {
		url: "https://admin.mailchimp.com/account/billing/",
		icon: "mailchimp",
	},
	hubspot: { url: "https://app.hubspot.com/settings/billing", icon: "hubspot" },
	intercom: {
		url: "https://app.intercom.com/a/apps/_/settings/billing",
		icon: "intercom",
	},

	// Education & Learning
	duolingo: { url: "https://www.duolingo.com/settings/plus", icon: "duolingo" },
	coursera: { url: "https://www.coursera.org/my-purchases", icon: "coursera" },
	udemy: {
		url: "https://www.udemy.com/join/my-courses/subscriptions/",
		icon: "udemy",
	},
	skillshare: {
		url: "https://www.skillshare.com/settings/payments",
		icon: "skillshare",
	},
	masterclass: {
		url: "https://www.masterclass.com/account/edit",
		icon: "masterclass",
	},
	babbel: { url: "https://www.babbel.com/prices", icon: "babbel" },

	// Fitness & Health
	peloton: { url: "https://www.onepeloton.com/membership", icon: "peloton" },
	strava: {
		url: "https://www.strava.com/settings/subscription",
		icon: "strava",
	},
	headspace: {
		url: "https://www.headspace.com/settings/subscription",
		icon: "headspace",
	},
	calm: { url: "https://www.calm.com/settings", icon: "calm" },
	myfitnesspal: {
		url: "https://www.myfitnesspal.com/premium",
		icon: "myfitnesspal",
	},
	whoop: { url: "https://app.whoop.com/settings/membership", icon: "whoop" },
	oura: { url: "https://cloud.ouraring.com/user/subscription", icon: "oura" },

	// Food & Delivery
	"uber one": { url: "https://www.ubereats.com/uber-one", icon: "uber" },
	dashpass: {
		url: "https://www.doordash.com/consumer/dashpass/",
		icon: "doordash",
	},
	"instacart+": {
		url: "https://www.instacart.com/store/account/instacart-plus",
		icon: "instacart",
	},
	"grubhub+": { url: "https://www.grubhub.com/grubhubplus", icon: "grubhub" },

	// Shopping
	"walmart+": { url: "https://www.walmart.com/plus", icon: "walmart" },
	costco: {
		url: "https://www.costco.com/my-life-membership-details.html",
		icon: "costco",
	},
	"sam's club": {
		url: "https://www.samsclub.com/account/membership",
		icon: "samsclub",
	},

	// Finance
	ynab: { url: "https://app.ynab.com/settings/subscription", icon: "ynab" },
	copilot: { url: "https://copilot.money/settings", icon: "copilot" },
	"monarch money": {
		url: "https://app.monarchmoney.com/settings/billing",
		icon: "monarch",
	},

	// Gaming
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

	// Dating (PG)
	tinder: { url: "https://tinder.com/app/settings", icon: "tinder" },
	bumble: { url: "https://bumble.com/settings", icon: "bumble" },
	hinge: { url: "https://hinge.co/settings", icon: "hinge" },

	// Communication & Other
	protonmail: {
		url: "https://account.proton.me/mail/subscription",
		icon: "proton",
	},
	proton: {
		url: "https://account.proton.me/mail/subscription",
		icon: "proton",
	},
	fastmail: {
		url: "https://www.fastmail.com/settings/billing/",
		icon: "fastmail",
	},
	hey: { url: "https://app.hey.com/settings/billing", icon: "hey" },
	zoom: { url: "https://zoom.us/account", icon: "zoom" },
	linkedin: {
		url: "https://www.linkedin.com/mypreferences/d/manage-subscription",
		icon: "linkedin",
	},
	nordvpn: {
		url: "https://my.nordaccount.com/dashboard/nordvpn/",
		icon: "nordvpn",
	},
	expressvpn: {
		url: "https://www.expressvpn.com/subscriptions",
		icon: "expressvpn",
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
