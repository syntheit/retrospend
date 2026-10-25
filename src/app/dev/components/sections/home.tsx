"use client";

import { GlanceStrip } from "~/components/glance/glance-strip";
import { NeedsYouItem } from "~/components/needs-you/needs-you-item";
import { NeedsYouList } from "~/components/needs-you/needs-you-list";
import { useToast } from "~/components/ui/toast";
import {
	GLANCE,
	GLANCE_NO_RATE,
	GLANCE_TRACK,
	NEEDS_YOU,
	NEEDS_YOU_MORE,
	NEEDS_YOU_PEOPLE,
} from "../fixtures/home";
import { CAP } from "../sections";
import { Cap, Pair, Spec, States } from "../spec";

export function GlanceSection() {
	return (
		<Spec id="glance">
			<Pair
				desktop={
					<>
						<Cap>{CAP.glanceA}</Cap>
						<GlanceStrip glance={GLANCE} />
						<Cap className="mt-6">{CAP.glanceB}</Cap>
						<GlanceStrip glance={GLANCE} variant="B" />
					</>
				}
				phone={
					<>
						<GlanceStrip glance={GLANCE} />
						<Cap className="mt-4">{CAP.glanceB}</Cap>
						<GlanceStrip glance={GLANCE} variant="B" />
					</>
				}
			/>
			<States
				className="mt-4"
				items={[
					[
						CAP.glanceNoRate,
						<div className="w-105 max-w-full" key="n">
							<GlanceStrip glance={GLANCE_NO_RATE} />
						</div>,
					],
					[
						CAP.glanceTrack,
						<div className="w-105 max-w-full" key="t">
							<GlanceStrip glance={GLANCE_TRACK} />
						</div>,
					],
				]}
			/>
		</Spec>
	);
}

export function NeedsSection() {
	const toast = useToast();
	const act = () => toast.info(CAP.fixtures);
	const one = (i: number, list = NEEDS_YOU) => {
		const item = list[i];
		return item ? (
			<ul className="w-105 max-w-full">
				<NeedsYouItem item={item} onAction={act} />
			</ul>
		) : null;
	};
	return (
		<Spec id="needs">
			<Pair
				desktop={
					<>
						<Cap>{CAP.listFlat}</Cap>
						<NeedsYouList items={NEEDS_YOU} onAction={act} />
					</>
				}
				phone={
					<>
						<Cap>{CAP.listGroup}</Cap>
						<NeedsYouList
							items={NEEDS_YOU.slice(0, 4)}
							onAction={act}
							variant="group"
						/>
					</>
				}
			/>
			<States
				className="mt-4"
				items={[
					[CAP.itemDefault, one(2)],
					[CAP.itemOverdue, one(0)],
					[CAP.itemSetup, one(0, NEEDS_YOU_MORE)],
					[CAP.itemRejected, one(1, NEEDS_YOU_MORE)],
					[CAP.itemBudget, one(2, NEEDS_YOU_MORE)],
					[CAP.itemShares, one(3, NEEDS_YOU_MORE)],
					[CAP.itemAging, one(4, NEEDS_YOU_MORE)],
					[
						CAP.itemFace,
						<div className="w-105 max-w-full" key="f">
							<NeedsYouList
								items={NEEDS_YOU_PEOPLE}
								onAction={act}
								onSecondary={act}
							/>
						</div>,
					],
					[
						CAP.itemMenu,
						<div className="w-105 max-w-full" key="m">
							<NeedsYouList
								items={NEEDS_YOU.slice(1, 3)}
								menu={{ open: act, later: act }}
								onAction={act}
							/>
						</div>,
					],
					[
						CAP.allClear,
						<div className="w-105 max-w-full" key="e">
							<NeedsYouList items={[]} />
						</div>,
					],
				]}
			/>
		</Spec>
	);
}
