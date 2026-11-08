import {
	BarChart3,
	Globe,
	Info,
	Receipt,
	ShieldCheck,
	Smartphone,
	TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";

export function SignupFeatures() {
	const t = useTranslations("auth");

	return (
		<div className="border-primary/20 bg-primary/5 space-y-3 rounded-lg border p-4">
			<div className="flex items-start gap-2">
				<Info className="text-primary mt-0.5 h-4 w-4 shrink-0" />
				<p className="text-primary text-sm font-medium">
					{t("sharedExpensesAutoLinked")}
				</p>
			</div>
			<p className="text-muted-foreground text-sm">{t("withYourOwnAccount")}</p>
			<ul className="text-muted-foreground grid gap-2 text-sm">
				<li className="flex items-center gap-2">
					<Smartphone className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureAccessAnyDevice")}
				</li>
				<li className="flex items-center gap-2">
					<ShieldCheck className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureSecureAccount")}
				</li>
				<li className="flex items-center gap-2">
					<BarChart3 className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureSpendingTracking")}
				</li>
				<li className="flex items-center gap-2">
					<TrendingUp className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureNetWorth")}
				</li>
				<li className="flex items-center gap-2">
					<Globe className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureMultiCurrency")}
				</li>
				<li className="flex items-center gap-2">
					<Receipt className="text-primary/70 h-3.5 w-3.5 shrink-0" />
					{t("featureImportStatements")}
				</li>
			</ul>
		</div>
	);
}
