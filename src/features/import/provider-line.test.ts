import importPage from "@retrospend/i18n/messages/en/importPage.json";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { providerLineOf } from "./provider-line";

const t = createTranslator({
	locale: "en",
	messages: { importPage },
	namespace: "importPage.provider",
});
const say = (key: string, values?: { model: string }) => (t as (k: string, v?: { model: string }) => string)(key, values);

describe("providerLineOf", () => {
	it("names OpenRouter and its model", () => {
		expect(
			providerLineOf(say, {
				provider: "OPENROUTER",
				model: "qwen/qwen-2.5-7b-instruct",
			}),
		).toBe("Read by OpenRouter (qwen/qwen-2.5-7b-instruct)");
	});

	it("says a local read happens on this server by Ollama", () => {
		expect(
			providerLineOf(say, { provider: "OLLAMA", model: "qwen2.5:7b" }),
		).toBe("Read on this server by Ollama (qwen2.5:7b)");
	});

	it("still names the provider when the model is not known", () => {
		expect(providerLineOf(say, { provider: "OPENROUTER", model: null })).toBe(
			"Read by OpenRouter",
		);
		expect(providerLineOf(say, { provider: "OLLAMA", model: null })).toBe(
			"Read on this server by Ollama",
		);
	});

	it("the file note is the plain sentence", () => {
		expect(importPage.serverNote).toBe("This file goes to the server.");
	});
});
