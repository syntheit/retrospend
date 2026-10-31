import type { SearchResult } from "@retrospend/api-contract";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { cleanQuery, HITS_PER_GROUP, MIN_QUERY, SEARCH_GROUPS } from "./rules";

export type SearchState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; result: SearchResult };

const DEBOUNCE_MS = 250;

/**
 * Runs the server's search for what is typed, after a short pause. Only the
 * newest answer is kept: a slower, older one is dropped. Text shorter than
 * one letter is idle, and a failed read is an error the screen can retry.
 */
export function useSearch(text: string) {
	const { api } = useSession();
	const [state, setState] = useState<SearchState>({ status: "idle" });
	const [attempt, setAttempt] = useState(0);
	const sequence = useRef(0);
	const query = cleanQuery(text);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` retries
	useEffect(() => {
		const mine = ++sequence.current;
		if (!api || query.length < MIN_QUERY) {
			setState({ status: "idle" });
			return;
		}
		setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
		const timer = setTimeout(() => {
			api.search
				.search({
					q: query,
					types: SEARCH_GROUPS.join(","),
					limit: HITS_PER_GROUP,
				})
				.then(
					(result) => {
						if (mine === sequence.current) setState({ status: "ready", result });
					},
					() => {
						if (mine === sequence.current) setState({ status: "error" });
					},
				);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [api, query, attempt]);

	return { query, state, retry: () => setAttempt((n) => n + 1) };
}
