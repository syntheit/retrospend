// Writes src/lib/account-icons/brands.json: the finance subset of Simple Icons
// (CC0) that the account icon picker offers. The SVG paths ship in our bundle,
// so nothing is fetched at runtime. Run after editing SLUGS:
//   pnpm exec node scripts/gen-account-icons.mjs
// A slug that Simple Icons no longer has stops the script, so the list never
// drifts silently when the package updates.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as icons from "simple-icons";

const SLUGS = [
	// Banks
	"hsbc",
	"chase",
	"bankofamerica",
	"wellsfargo",
	"goldmansachs",
	"deutschebank",
	"commerzbank",
	"sparkasse",
	"barclays",
	"caixabank",
	"aib",
	"axisbank",
	"hdfcbank",
	"icicibank",
	// Fintechs and neobanks
	"revolut",
	"wise",
	"n26",
	"monzo",
	"starlingbank",
	"nubank",
	"bunq",
	"klarna",
	"afterpay",
	"neon",
	"picpay",
	"pagseguro",
	"kueski",
	"tide",
	// Wallets and payments
	"paypal",
	"mercadopago",
	"cashapp",
	"venmo",
	"zelle",
	"applepay",
	"googlepay",
	"samsungpay",
	"payoneer",
	"alipay",
	"wechat",
	"paytm",
	"phonepe",
	"rakuten",
	"vivawallet",
	"webmoney",
	"westernunion",
	"moneygram",
	// Cards
	"visa",
	"mastercard",
	"americanexpress",
	"discover",
	"jcb",
	"dinersclub",
	// Brokers
	"robinhood",
	"zerodha",
	// Crypto exchanges, wallets and coins
	"binance",
	"coinbase",
	"kucoin",
	"okx",
	"uphold",
	"blockchaindotcom",
	"trezor",
	"bitcoin",
	"ethereum",
	"solana",
	"tether",
	"litecoin",
	"dogecoin",
];

const bySlug = new Map(Object.values(icons).map((i) => [i.slug, i]));
const out = SLUGS.map((slug) => {
	const i = bySlug.get(slug);
	if (!i) throw new Error(`Simple Icons has no "${slug}"`);
	return { slug: i.slug, title: i.title, hex: i.hex, path: i.path };
}).sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));

const target = join(import.meta.dirname, "..", "src/lib/account-icons/brands.json");
writeFileSync(target, `${JSON.stringify(out, null, "\t")}\n`);
console.log(`wrote ${out.length} logos to ${target}`);
