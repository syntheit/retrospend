# Motion in the mobile apps

How Retrospend moves on iOS and Android. It applies GUIDELINE §11 and the motion tokens (§2.6) to the Expo app. The code side is `apps/mobile/src/ui/motion.ts`.

## Rules

- Motion answers a state change. Nothing moves on page load, nothing loops except skeletons.
- Durations come from the tokens: 120 state, 160 menus, 200 rows, 220 sheets and tabs.
- Curves: `ease-land` for things arriving, `ease-leave` for things leaving. No springs, no bounce, no overshoot.
- Money never animates. A changed amount is replaced in place, no slide, no count. A row that holds money may move as a row.
- Reduced motion is opacity only: movement jumps to its end, fades still run.
- Where the platform has its own motion, the platform's wins. We do not redraw it.

## Patterns

| Pattern | Motion | Where |
|---|---|---|
| Sheets present and dismiss | Native (SwiftUI sheet with detents, M3 modal bottom sheet) | Every `Sheet` |
| Push and pop | Native stack transition and back gesture | Every tab stack, Settings |
| Bottom tabs | Native, no custom motion. Each tab keeps its stack and scroll. Tapping the open tab pops to its root, tapping again scrolls to the top (native repeated selection) | `ui/Tabs` |
| Leaving a tab | Closes passing UI at once: an open swipe row, a menu, bulk select. An iPad's list-detail selection stays | `ui/transient`, `ui/Tabs` |
| Row menu | iOS: the system context menu lifts the row as its preview and the page dims in place. Android: an M3 dropdown opens at the row where the finger held it, after the system's 400 hold, with the long-press haptic | `ui/RowMenu` |
| Page menus | Native (SwiftUI Menu, M3 dropdown) | `ui/Menu` |
| Segmented controls | Native (UISegmentedControl, M3 segmented buttons) | `ui/Segmented` |
| Underline tabs: indicator | The teal line slides and resizes to the open tab, 220 land. A press draws no box or ripple. Reduced motion: the line fades out and back in at the new tab (120) | `ui/UnderlineTabs` (People and Projects, a project's tabs) |
| Underline tabs: pane | The new pane fades in while it slides a short way from the side of the tab it came from, 220 land. Reduced motion: the fade alone | `PeopleHub`, `ProjectView` via `usePaneEnter` |
| Swipe row | Follows the finger one to one, starts only on a sideways drag (20 across before 10 up or down), settles in 200 land, no overshoot. Reduced motion: settles at once. One row open at a time | `ui/SwipeRow` |
| Row insert | A row joining a group on screen fades in (200) while the rows below and the group's edge slide down | `ui/List` `ListGroup` |
| Row remove | A removed row fades out (200) while the rows below close the gap; its Undo toast brings it back the same way | `ui/List` `ListGroup` |
| Show more, Show fewer | Rows added to or taken from a group use the row insert and remove motion | Needs you, a person's ledger, an account's history |
| Expanding section | A section that opens fades in (200) and fades out when it closes | Closed accounts in Wealth |
| Skeleton to content | Placeholders pulse (opacity, held still with reduced motion) and fade out in 120 as the content takes their place | `ui/Skeleton` |
| Toast | Fades in and rises a little (220 land), fades out (120 leave). Reduced motion: the fades alone | `ui/Toast` |
| Press | Rows take the raised fill while pressed, no animation; Android buttons keep the system ripple | `ListRow`, native buttons |
| Charts | Draw in place, no motion | `ui/charts` |
| Numbers and money | No motion, ever | `MoneyAmount`, `Hero`, totals |

## Not animated on purpose

- Groups and rows that arrive with their list (first load, a list mounting rows as it scrolls) and rows that leave with it.
- Selection highlight and bulk-select checks: they change at once.
- A tab tap's own feedback: the moving indicator is the answer.
