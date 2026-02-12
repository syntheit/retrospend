import { Button } from "~/components/ui/button";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

interface TableFiltersProps {
	// State
	selectedYears: Set<number>;
	selectedMonths: Set<number>;
	selectedCategories: Set<string>;

	// Available Options
	availableYears: number[];
	availableMonths: number[];
	availableCategories: {
		id: string;
		name: string;
		color: string;
		usageCount: number;
	}[];

	// Handlers
	toggleYear: (year: number) => void;
	toggleMonth: (month: number) => void;
	toggleCategory: (categoryId: string) => void;
	clearYears: () => void;
	clearMonths: () => void;
	clearCategories: () => void;
}

export function TableFilters({
	selectedYears,
	selectedMonths,
	selectedCategories,
	availableYears,
	availableMonths,
	availableCategories,
	toggleYear,
	toggleMonth,
	toggleCategory,
	clearYears,
	clearMonths,
	clearCategories,
}: TableFiltersProps) {
	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="font-medium text-sm">Filter by Year</h3>
					<Button
						className="h-6 px-2 text-xs"
						disabled={selectedYears.size === 0}
						onClick={clearYears}
						size="sm"
						variant="ghost"
					>
						Clear years
					</Button>
				</div>
				<div className="flex flex-wrap gap-2">
					{availableYears.map((year) => (
						<Button
							aria-pressed={selectedYears.has(year)}
							className="h-8 min-w-[60px]"
							key={year}
							onClick={() => toggleYear(year)}
							size="sm"
							variant={selectedYears.has(year) ? "default" : "outline"}
						>
							{year}
						</Button>
					))}
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="font-medium text-sm">Filter by Month</h3>
					<Button
						className="h-6 px-2 text-xs"
						disabled={selectedMonths.size === 0}
						onClick={clearMonths}
						size="sm"
						variant="ghost"
					>
						Clear months
					</Button>
				</div>
				<div className="flex flex-wrap gap-2">
					{availableMonths.map((month) => (
						<Button
							aria-pressed={selectedMonths.has(month)}
							className="h-8 min-w-[80px]"
							key={month}
							onClick={() => toggleMonth(month)}
							size="sm"
							variant={selectedMonths.has(month) ? "default" : "outline"}
						>
							{MONTH_NAMES[month]}
						</Button>
					))}
				</div>
			</div>

			{availableCategories.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h3 className="font-medium text-sm">Filter by Category</h3>
						<Button
							className="h-6 px-2 text-xs"
							disabled={selectedCategories.size === 0}
							onClick={clearCategories}
							size="sm"
							variant="ghost"
						>
							Clear categories
						</Button>
					</div>
					<div className="flex flex-wrap gap-2">
						{availableCategories.map((category) => (
							<Button
								aria-pressed={selectedCategories.has(category.id)}
								className="flex h-8 min-w-[100px] items-center gap-2"
								key={category.id}
								onClick={() => toggleCategory(category.id)}
								size="sm"
								variant={
									selectedCategories.has(category.id) ? "default" : "outline"
								}
							>
								<div
									className={`h-3 w-3 rounded-full ${
										CATEGORY_COLOR_MAP[
											category.color as keyof typeof CATEGORY_COLOR_MAP
										]?.split(" ")[0] || "bg-gray-400"
									}`}
								/>
								{category.name}
							</Button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
