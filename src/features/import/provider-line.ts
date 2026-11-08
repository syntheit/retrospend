"use client";

import { useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";

type AiStatus = RouterOutputs["settings"]["getAiStatus"];
type Provider = Pick<AiStatus, "provider" | "model">;
type Say = (key: string, values?: { model: string }) => string;

/**
 * The sentence that names who reads an import file: this server's Ollama or
 * OpenRouter, with the model when the server knows it.
 */
export function providerLineOf(say: Say, ai: Provider): string {
	const key = ai.provider === "OPENROUTER" ? "openrouter" : "ollama";
	return ai.model ? say(`${key}Model`, { model: ai.model }) : say(key);
}

export function useProviderLine(ai: Provider | undefined): string | undefined {
	const t = useTranslations("importPage.provider");
	return ai ? providerLineOf(t, ai) : undefined;
}
