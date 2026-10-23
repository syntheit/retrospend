"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/cn";

const STEPS = ["choose", "read", "review", "done"] as const;

/**
 * Where the import is (import.html's Stepper, a page-local part the kit
 * does not have): four numbered steps on desktop, "Step 2 of 4" with a bar
 * on phones. `caption` names how step 2 read the file once it is past.
 */
export function Stepper({
	current,
	caption,
}: {
	/** 1 to 4. */
	current: number;
	caption?: string | null;
}) {
	const t = useTranslations("importPage.steps");
	const name = STEPS[current - 1] ?? "choose";
	return (
		<>
			<ol
				aria-label={t("label")}
				className="mb-6 flex flex-wrap items-center gap-2 max-md:hidden"
			>
				{STEPS.map((step, i) => {
					const n = i + 1;
					const done = n < current;
					const here = n === current;
					return (
						<Fragment key={step}>
							{i > 0 && (
								<li aria-hidden="true" className="bg-line-strong h-px w-10" />
							)}
							<li
								aria-current={here ? "step" : undefined}
								className={cn(
									"text-body flex items-center gap-2 font-medium",
									here ? "text-fg" : done ? "text-fg-2" : "text-fg-3",
								)}
							>
								<span
									className={cn(
										"text-meta inline-flex size-6 items-center justify-center rounded-full border",
										here
											? "border-brand bg-brand text-brand-fg"
											: done
												? "border-line-strong bg-raised text-fg-2"
												: "border-line-strong",
									)}
								>
									{done ? <Check aria-hidden="true" className="size-4" /> : n}
								</span>
								<span>
									{t(step)}
									{n === 2 && done && caption ? (
										<span className="text-fg-3 text-meta font-normal">
											{" · "}
											{caption}
										</span>
									) : null}
								</span>
							</li>
						</Fragment>
					);
				})}
			</ol>
			<div className="mb-4 md:hidden">
				<p className="text-fg-2 text-small mb-2">
					<span className="text-fg font-semibold">
						{t("of", { n: current })}
					</span>
					{" · "}
					{t(name)}
				</p>
				<Progress aria-label={t("of", { n: current })} value={current * 25} />
			</div>
		</>
	);
}
