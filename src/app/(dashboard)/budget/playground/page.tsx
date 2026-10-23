import { redirect } from "next/navigation";

/**
 * The Playground is gone (budget SPEC §7, D2): its Apply wrote real budgets.
 * Plan next month and What if replace it, on the Budget page. Old links and
 * bookmarks land there; the old page ignores the view parameter.
 */
export default function PlaygroundRedirect() {
	redirect("/budget?view=plan");
}
