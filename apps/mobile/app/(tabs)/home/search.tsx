import { SearchScreen } from "@/features/search/SearchScreen";

// Search opens inside Home's stack (from its top bar), so what it opens
// (an expense, a person, a project) opens in that stack too and Back
// returns to the results.
export default function HomeSearchRoute() {
	return <SearchScreen />;
}
