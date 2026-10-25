"use client";

import { useState } from "react";
import { BalanceBar } from "~/components/charts/balance-bar";
import { MonthlyBars } from "~/components/charts/monthly-bars";
import {
	type AreaPoint,
	NetWorthArea,
} from "~/components/charts/net-worth-area";
import { PaceLine } from "~/components/charts/pace-line";
import { RankedBars } from "~/components/charts/ranked-bars";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import {
	BALANCE_SEGMENTS,
	EMPTY_MONTHS,
	MONTHS,
	NET_WORTH,
	PACE,
	RANKED,
} from "../fixtures/home";
import { m } from "../fixtures/rows";
import { CAP } from "../sections";
import { Cap, Pair, Phone, Spec, States } from "../spec";

/** The area with its hero: scrubbing shows that day, letting go shows today. */
function ScrubbedArea({ height, phone }: { height: number; phone?: boolean }) {
	const [at, setAt] = useState<AreaPoint | null>(null);
	const { short } = useRowDates();
	const shown = at ?? NET_WORTH[NET_WORTH.length - 1];
	return (
		<div>
			<div className="mb-2 flex items-baseline gap-2">
				<Money
					className={
						phone ? "text-section font-semibold" : "text-title font-semibold"
					}
					value={shown?.value ?? null}
				/>
				{at && <span className="text-fg-3 text-meta">{short(at.date)}</span>}
			</div>
			<NetWorthArea
				currency="ARS"
				height={height}
				onScrub={setAt}
				points={NET_WORTH}
			/>
		</div>
	);
}

/** Monthly bars whose bars open their month: the pick shows under the chart. */
function SelectableBars({ height }: { height?: number }) {
	const [picked, setPicked] = useState<number | null>(null);
	const { month } = useRowDates();
	const at = picked === null ? undefined : MONTHS[picked];
	return (
		<div>
			<MonthlyBars
				currency="ARS"
				height={height}
				months={MONTHS}
				onSelect={setPicked}
			/>
			<p className="text-fg-3 text-meta mt-2">
				{at ? CAP.barsOpens(month(at.month)) : CAP.barsPick}
			</p>
		</div>
	);
}

export function ChartSection() {
	const { month } = useRowDates();
	const name = month("2026-10-01");
	const balance = (phone: boolean) => (
		<BalanceBar
			owedToYou={m("1520393")}
			phone={phone}
			segments={BALANCE_SEGMENTS}
			youOwe={m("197970")}
		/>
	);
	return (
		<Spec id="chart">
			<Pair
				desktop={
					<>
						<Cap>{CAP.pace}</Cap>
						<PaceLine
							axis
							currentLabel={name}
							height={110}
							pace={PACE}
							previousLabel={CAP.previous}
						/>
						<Cap className="mt-6">{CAP.bars}</Cap>
						<MonthlyBars currency="ARS" months={MONTHS} />
						<Cap className="mt-6">{CAP.barsLinked}</Cap>
						<SelectableBars />
						<Cap className="mt-6">{CAP.area}</Cap>
						<ScrubbedArea height={200} />
					</>
				}
				phone={
					<>
						<PaceLine
							axis
							currentLabel={name}
							height={96}
							pace={PACE}
							previousLabel={CAP.previous}
						/>
						<div className="h-5" />
						<MonthlyBars currency="ARS" height={180} months={MONTHS} />
						<div className="h-5" />
						<SelectableBars height={160} />
						<div className="h-5" />
						<ScrubbedArea height={160} phone />
					</>
				}
			/>
			<div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
				<div>
					<Cap>{CAP.ranked}</Cap>
					<RankedBars items={RANKED} />
				</div>
				<Phone>
					<RankedBars items={RANKED.slice(0, 4)} />
				</Phone>
			</div>
			<div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
				<div>
					<Cap>{CAP.balance}</Cap>
					{balance(false)}
				</div>
				<Phone>{balance(true)}</Phone>
			</div>
			<States
				className="mt-6"
				items={[
					[
						CAP.emptySeries,
						<div className="w-80" key="e">
							<MonthlyBars currency="ARS" height={120} months={EMPTY_MONTHS} />
						</div>,
					],
					[
						CAP.emptyPace,
						<div className="w-80" key="p">
							<PaceLine
								currentLabel={name}
								height={72}
								pace={{ currency: "ARS", days: 31, current: [], previous: [] }}
								previousLabel={CAP.previous}
							/>
						</div>,
					],
				]}
			/>
			<Cap className="mt-4">{CAP.reduced}</Cap>
		</Spec>
	);
}
