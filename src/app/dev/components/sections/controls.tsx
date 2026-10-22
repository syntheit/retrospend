"use client";

import { Ellipsis, Plus, Trash2 } from "lucide-react";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Tip } from "~/components/ui/tooltip";
import { m } from "../fixtures/rows";
import { Spec, States } from "../spec";
import { S } from "./atoms";

/** States the browser only shows on interaction, drawn with the same classes. */
const F = {
	hover: "Hover",
	focus: "Focus-visible",
	inputFocus: "Focus",
	groceries: "Groceries",
	error: "Error",
	errorMsg: "Add a title",
	switchOff: "Switch off",
	on: "on",
	ring: "outline-2 outline-brand outline-offset-2",
};

export function ButtonsSection() {
	return (
		<Spec id="buttons">
			<States
				items={[
					[
						S.primary,
						<Button key="a" kind="primary">
							<Plus />
							{S.add}
						</Button>,
					],
					[
						S.secondary,
						<Button key="b" kind="secondary">
							{S.cancel}
						</Button>,
					],
					[
						S.ghost,
						<Button key="c" kind="ghost">
							{S.more}
						</Button>,
					],
					[
						S.danger,
						<Button key="d" kind="danger">
							<Trash2 />
							{S.delete}
						</Button>,
					],
					[
						S.disabled,
						<Button disabled key="e" kind="primary">
							{S.record}
						</Button>,
					],
					[
						S.loading,
						<Button key="f" kind="primary" loading>
							{S.saving}
						</Button>,
					],
					[
						S.small,
						<Button key="g" kind="secondary" size="sm">
							{S.confirm}
						</Button>,
					],
					[
						F.hover,
						<Button className="bg-brand-hover" key="hv" kind="primary">
							{F.hover}
						</Button>,
					],
					[
						F.focus,
						<Button className={F.ring} key="fv" kind="secondary">
							{F.focus}
						</Button>,
					],
					[
						S.icon,
						<Tip content={S.more} key="h">
							<Button aria-label={S.more} icon kind="ghost">
								<Ellipsis />
							</Button>
						</Tip>,
					],
				]}
			/>
			<div className="mt-6 grid gap-6 md:grid-cols-2">
				<States
					items={[
						[
							S.input,
							<Input
								aria-label={S.title}
								className="w-55"
								key="a"
								placeholder={S.title}
							/>,
						],
						[
							F.inputFocus,
							<Input
								aria-label={S.title}
								className={`w-55 ${F.ring}`}
								defaultValue={F.groceries}
								key="f"
							/>,
						],
						[
							F.error,
							<span className="flex flex-col gap-1" key="b">
								<Input aria-invalid aria-label={S.title} className="w-55" />
								<span className="text-danger text-meta">{F.errorMsg}</span>
							</span>,
						],
						[
							S.disabled,
							<Input
								aria-label={S.title}
								className="w-55"
								defaultValue={S.locked}
								disabled
								key="c"
							/>,
						],
					]}
				/>
				<States
					items={[
						[F.switchOff, <Switch aria-label={F.switchOff} key="o" />],
						[F.on, <Switch aria-label={S.switchOn} defaultChecked key="a" />],
						[
							S.disabled,
							<Switch
								aria-label={S.disabled}
								defaultChecked
								disabled
								key="b"
							/>,
						],
						[
							S.checkbox,
							<Checkbox aria-label={S.checkbox} defaultChecked key="c" />,
						],
					]}
				/>
			</div>
		</Spec>
	);
}

export function TooltipSection() {
	return (
		<Spec id="tooltip">
			<States
				items={[
					[
						S.tipPair,
						<Money.pair
							home={m("89529")}
							key="a"
							original={m("63.40", "USD")}
							tip={S.rate}
						/>,
					],
					[
						S.tipIcon,
						<Tip content={S.about} key="b">
							<Button aria-label={S.about} icon kind="ghost">
								<Ellipsis />
							</Button>
						</Tip>,
					],
				]}
			/>
		</Spec>
	);
}
