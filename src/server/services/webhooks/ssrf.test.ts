import { describe, expect, it } from "vitest";
import {
	checkWebhookTarget,
	isBlockedAddress,
	type Resolver,
	WebhookTargetError,
} from "./ssrf";

const fixed =
	(...addresses: string[]): Resolver =>
	async () =>
		addresses;

async function refusal(raw: string, resolve: Resolver, allowPrivate = false) {
	try {
		await checkWebhookTarget(raw, { allowPrivate, resolve });
	} catch (error) {
		if (error instanceof WebhookTargetError) return error.code;
		throw error;
	}
	return null;
}

describe("isBlockedAddress", () => {
	it.each([
		"127.0.0.1",
		"127.255.255.254",
		"10.0.0.1",
		"10.255.1.1",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.10",
		"169.254.169.254",
		"169.254.0.1",
		"100.64.0.1",
		"0.0.0.0",
		"255.255.255.255",
		"224.0.0.1",
		"192.0.2.5",
		"198.18.0.1",
		"::1",
		"::",
		"fe80::1",
		"fd00:ec2::254",
		"fc00::1",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:169.254.169.254",
		"::ffff:10.1.2.3",
		"64:ff9b::7f00:1",
		"64:ff9b::a9fe:a9fe",
		"2002:7f00:1::1",
		"2001:db8::1",
		"not an ip",
		"",
	])("blocks %s", (ip) => {
		expect(isBlockedAddress(ip)).toBe(true);
	});

	it.each([
		"8.8.8.8",
		"1.1.1.1",
		"93.184.216.34",
		"172.15.255.255",
		"172.32.0.1",
		"100.63.255.255",
		"192.169.0.1",
		"2606:4700:4700::1111",
		"2001:4860:4860::8888",
		"::ffff:8.8.8.8",
		"64:ff9b::808:808",
	])("allows %s", (ip) => {
		expect(isBlockedAddress(ip)).toBe(false);
	});
});

describe("checkWebhookTarget", () => {
	const pub = fixed("93.184.216.34");

	it("accepts an https URL that resolves to a public address", async () => {
		const target = await checkWebhookTarget("https://hooks.example.com/in", {
			allowPrivate: false,
			resolve: pub,
		});
		expect(target.addresses).toEqual(["93.184.216.34"]);
	});

	it.each([
		"https://127.0.0.1/hook",
		"https://10.0.0.5/hook",
		"https://169.254.169.254/latest/meta-data",
		"https://[::1]/hook",
		"https://[::ffff:127.0.0.1]/hook",
		"https://2130706433/hook",
		"https://0x7f.1/hook",
		"https://localhost/hook",
		"https://api.localhost/hook",
		"https://printer.local/hook",
		"https://metadata.google.internal/",
	])("refuses %s", async (url) => {
		expect(await refusal(url, pub)).toBe("blocked_target");
	});

	it("refuses a host name that resolves to a private address", async () => {
		expect(
			await refusal("https://innocent.example.com/", fixed("10.1.2.3")),
		).toBe("blocked_target");
	});

	it("refuses when any one of several addresses is private", async () => {
		expect(
			await refusal(
				"https://mixed.example.com/",
				fixed("93.184.216.34", "127.0.0.1"),
			),
		).toBe("blocked_target");
		expect(
			await refusal(
				"https://mixed6.example.com/",
				fixed("93.184.216.34", "fe80::1"),
			),
		).toBe("blocked_target");
	});

	it("refuses a name that does not resolve", async () => {
		const none: Resolver = async () => {
			throw new Error("ENOTFOUND");
		};
		expect(await refusal("https://nope.example.com/", none)).toBe(
			"unresolvable",
		);
		expect(await refusal("https://empty.example.com/", fixed())).toBe(
			"unresolvable",
		);
	});

	it("needs https, and no credentials in the URL", async () => {
		expect(await refusal("http://hooks.example.com/", pub)).toBe(
			"https_required",
		);
		expect(await refusal("ftp://hooks.example.com/", pub)).toBe(
			"https_required",
		);
		expect(await refusal("https://user:pw@hooks.example.com/", pub)).toBe(
			"credentials_not_allowed",
		);
		expect(await refusal("not a url", pub)).toBe("invalid_url");
	});

	it("lets private targets and plain http through when the admin allows them", async () => {
		const lan = await checkWebhookTarget("http://192.168.1.20:8080/in", {
			allowPrivate: true,
		});
		expect(lan.addresses).toEqual(["192.168.1.20"]);
		expect(
			await refusal("http://nas.lan/in", fixed("10.0.0.7"), true),
		).toBeNull();
		expect(
			await refusal("https://localhost/in", fixed("::1"), true),
		).toBeNull();
	});
});
