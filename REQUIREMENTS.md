# Werewolf requirements

M1 delivers room setup and private role distribution. M2 adds a complete playable match. M3 adds spectating and seat replacement for disconnected players.

This document defines the app’s required behavior and acceptance criteria. Use the [狼人杀规则手册 v18.1, 2026-10-21](docs/rules/werewolf_rules_v18.1_2026-10-21.pdf) as a reference for board rules and unresolved cases. Within the handbook, board-specific provisions take precedence over general provisions.

Choose internal states, transition boundaries and prompts that fit the app and preserve its documented behavior. When a tradeoff changes player choices, information visibility or timing, or game outcomes, record the agreed app behavior here before implementing it. Before implementing each supported board, check its requirements against the handbook for missing gameplay-relevant rules; record unresolved rulings rather than silently treating omissions as permission to change behavior.

## Product and interface

Build a mobile browser app for friends playing at the same table or talking on a separate call. Each player uses their own phone. The host also plays. Use Fengsheng’s invite, seating, and reconnect flows as references.

- Target portrait iPhone Safari and Android Chrome. An invite opens directly in the browser. Provide touch-friendly actions, clear room status, and an accessible seat grid that fits narrow screens without horizontal scrolling.
- Use Simplified Chinese for player-facing copy as a working assumption.
- Match the supplied [米多狼人面杀助手 screenshots](docs/ui-references/README.md) for the M1 screens, including the layout, typography, palette, and supplied artwork. Use browser-native phone chrome and keep the account-free nickname steps.

## M1. Room setup and private role distribution

### Board presets

| Preset | Twelve seats | Handbook reference |
| --- | --- | --- |
| 机械狼通灵师 | 3 小狼 and 1 机械狼, 4 神 (通灵师、女巫、守卫、猎人), and 4 村民. | §6.4 |
| 预女猎白混 | 4 狼人, 4 神 (预言家、女巫、猎人、白痴／白神), and 4 民 (3 村民 and 1 混血儿). | §6.1 |
| 盗宝大师 | 3 小狼 and 1 盗宝大师, 4 ordinary 神, and 4 村民. The 盗宝大师 seat also holds one randomly assigned 神 card and one 村民 card. | §6.3 with the draw restriction below |

For **盗宝大师**, draw its 神 card once per deal from 毒师、摄梦人、猎人、通灵师. The eligible cards are equally likely. The draw and seat assignments are saved together and restored on retry or reconnect. The handbook's 12-seat deal uses 14 cards, with 盗宝大师 holding a wolf card and the two extra cards.

蒙面人 always goes to an ordinary 神 seat. The three eligible cards that 盗宝大师 did not draw fill the other ordinary 神 seats. Shuffle those four cards among the ordinary 神 seats.

### Room flow

1. **Create and share.** The host previews the board and creates a room. The lobby provides an 邀请好友 action that opens the phone's share sheet when available and offers a copy-link option. The link identifies the room and can be pasted into a group chat.
2. **Enter the room.** Tapping an invite opens that room directly. A returning player with a valid room credential resumes their session automatically. A new guest enters their nickname on the room screen, then sees the lobby and public role counts. When all seats are taken, offer new guests 观战. The home screen's 加入房间 action also supports entry with a short room code.
3. **Take a seat.** The host starts in seat 1 when the room is created. Before the deal, players can claim vacant numbered seats or stand up. Everyone sees occupied, vacant, and disconnected seats. Before the deal the host can remove a guest, including one who is disconnected or unseated. Removal revokes the guest's room session, frees any seat they held, and updates the lobby for everyone.
4. **Deal once.** Once all 12 seats are occupied and connected, the host confirms the deal. The server shuffles and assigns one role to each seat and locks the roster in the same operation. Concurrent seat claims and repeated deal commands resolve once. The host sees only their own role assignment.
5. **Reveal and acknowledge.** Players open their own role card, read the role and ability, and acknowledge receipt. They can reopen the card. The lobby shows acknowledgement status by seat and a clear completion state when all 12 have acknowledged. M1 ends at that state.

### Mobile setup screens

- **Home and setup.** Make 创建房间, 加入房间, and 回到最近一局 the primary home actions. Creating a room opens the quick preset selector with the three boards, then previews the selected board's player count and role lineup before confirmation. For 盗宝大师, show four ordinary 神 seats and label the four possible cards for the Thief's random draw. Keep the actual draw out of the public preview and lobby.
- **Room and seat grid.** Place the room code, setup status, own seat number, and 查看我的身份 above the room actions and three-column seat grid. Show the host, connection status, and acknowledgement status with clear labels. Keep the invite and 本局配置 accessible. In 房主操作, let the host select a guest and confirm removal before the deal. Tell a removed guest that their room session has ended.
- **Role and confirmation panels.** Open a dismissible, private role card on demand after the deal. Reuse the same role widget for 机械狼 and 盗宝大师 with each role's own name and description. Only the 盗宝大师 seat sees its two extra cards in that widget. Each seat acknowledges receipt once. Return the player to the lobby when the card is dismissed. Ask the host to confirm the deal before locking the roster.

### Account-free reconnect

- **Guest data.** Require a nickname and offer an optional photo when creating or joining a room. Players can change or remove their photo under 编辑资料. Share the photo thumbnail with players in that room and keep it alongside the room session. A room expires after 24 hours with no connected players by default. Delete saved state and invalidate its credentials on expiry.
- **Resume on the same browser.** Issue an opaque, unguessable credential when the guest enters the room and associate it with their seat once taken. Retain it in the browser across reloads. Reconnect automatically after a signal drop, Wi-Fi change, or phone sleep. Both the invite and 回到最近一局 must resume the existing session. A room code and nickname authorize joining an open room only. Keep credentials out of shared links, public state, and logs.
- **Restore setup state.** Recover the player's room, seat, role assignment, and acknowledgement after reconnect, including after a server restart. Save each accepted change and its outcome before acknowledging it. A retry after a lost acknowledgement must recover the original outcome without repeating the change.
- **Connection status and control.** Show reconnect progress and disable actions until restored state arrives. Allow one connection to control each session. When a new connection takes over, tell the older tab and let it request control explicitly. Restore host controls to the host's active session only. Explain expired rooms and missing credentials. Recovery covers the original browser profile with its credential intact.

### Render hosting

Deploy M1 from the private GitHub repository to a Render web service. Serve the mobile app and room backend at one HTTPS origin so invites can open the room directly on a friend's phone. Use durable storage for room state, including the deal and reconnect credentials, so rooms survive restarts and redeploys within their retention window.

### M1 acceptance

- On portrait iPhone Safari and Android Chrome, create a room, join from a link and a code, and complete a 12-seat deal and acknowledgement flow. Check the three presets, role card, and seat grid on a narrow phone. Verify all three presets deal their expected seat and card counts.
- Share the room link in chat and tap it on a second phone. Verify that a new guest lands on the correct room screen and can join with only a nickname. Verify that a returning guest opens the same link and resumes their seat, including after the deal.
- Verify that the host starts in seat 1 and can move before the deal. Select a photo, check the preview, and verify that another player sees the thumbnail in the lobby. Check that it survives reconnect and disappears on removal.
- Verify that only the host can deal and that seating and connection requirements are enforced. Test a concurrent seat claim and repeated deal requests, including a lost acknowledgement. Verify that the final deck matches the selected board and seats remain fixed after the deal.
- Verify that only the host can remove a guest and only before roles are dealt. Confirm that removing a seated guest frees their seat and invalidates their reconnect credential. Race that removal against a deal. If removal is accepted first, the room must refill the seat before dealing. If the deal is accepted first, the roster lock must prevent removal.
- With independent sessions, verify that every player, including the host, receives only their own role. A fresh browser with the invite or a nickname cannot recover a dealt seat.
- For 盗宝大师, test all four possible 神 draws. Verify that each deal has 14 cards across 12 seats and that 蒙面人 and the three undrawn 神 cards go to the four ordinary 神 seats. Verify that only the 盗宝大师 seat receives its extra cards and that the same draw and cards return after reconnect and deal retry.
- Verify recovery after refresh, phone backgrounding, network change, and server restart before and after the deal. Check that the same role, acknowledgement, and host status return. Verify duplicate-tab control and expiry.
- On the deployed Render service, open a shared invite from a second phone and verify room entry. Restart the service with a test room and verify that its seat and role assignments survive.

## M2. Full match play

The host can start Night 1 once all players have acknowledged their roles and are connected. Run the match through night actions, discussion, voting, resolution, victory, and rematch in the same room.

### Mobile match screens

- **Phase and seat status.** Keep the current phase, speaker, public announcements, and available action above the numbered seats. Add the sheriff badge and public elimination state. Confirm consequential player and host actions.
- **Player actions.** Show two explicit choices for sheriff candidacy (上警 / 不上警). Offer withdrawal and voting only to eligible seats in the relevant window. Allow players to open and dismiss their own action details. Show 自爆 only to a wolf with a legal self-destruct action, and confirm it on that player's phone.
- **Public match history (对局详情).** Group published events by night and day. Show no-elimination nights, announced exits, public reasons such as exile or self-destruct, and sheriff and voting outcomes at their publication points. Add 警长票型 and 查看票型 for completed ballots, with separate results for a runoff. The detail sheet groups voters by the target seat, shows the weighted totals, and lists abstentions. Keep private causes, targets, inspections, and unreleased votes out of the public history. Closing the ballot sheet returns to history. Closing history returns to the current phase.
- **Results and rematch.** At game end, show the winner and the full role roster. Let the host return the group to the same room and seats for a fresh deal.
- **Help and role reference (用法简介).** Explain the room flow, the current board's phase order, its roles, and common reconnect questions. Make the board's roles browsable by category and searchable by Chinese name. Show public ability descriptions independently of a player's assigned role.

### Host controls

The host can open the sheriff election, advance speaking and last words, publish resolved night information, open voting, and start the next night when the server permits each transition. Night publication follows the sheriff election and interruption rules. The server checks victory as soon as a death is formal, including before a host announcement.

- **Discussion timer.** Provide a shared countdown the host can start. Treat expiry as a cue to finish speaking. The phase changes through the legal game control.
- **Voting progress.** Show the host received and expected ballot counts. Show pending seat numbers only for voting windows where that information is allowed. If early close is permitted, offer to keep waiting or confirm closing the ballot and show how missing ballots will be counted. Keep this control gated on the ruling for missing ballots.
- **Ownership and recovery.** Keep administrative actions in a host menu and keep room ownership separate from the sheriff badge. Badge transfer or destruction follows the board's rules. A fresh deal after a completed game follows the rematch flow.

### Rules required for match play

The following requirements cover the three supported presets. Preserve their player-visible choices, information and outcomes; the server need not reproduce physical-table procedures as distinct internal phases. Section numbers refer to the handbook linked above. Unresolved decisions are listed separately below.

#### Shared death, victory and night resolution (§§1–2, 4.2–4.3, 5.1)

- Use side elimination (屠边): wolves win when all good-side 神 or all 民 have formally left; the good side wins when all wolves have formally left. Check victory at each formal death or simultaneous resolution. Wolves win if the last wolf and the last member of a required good-side category die in the same related resolution.
- End immediately when a win is established, even at night. Do not process remaining last words, shots, death skills or badge transfers. Announcing deaths is separate from formal death and does not itself determine victory.
- Collect legal night actions privately and resolve effects across the whole night. Earlier lethal effects do not automatically cancel a role's legal action; protection covers the entire night, subject to board-specific exceptions. Give each role only the information available at its action point, without revealing later actions.
- When the Witch has an unused antidote, show the ordinary wolf-knife target, including an inherited ordinary mechanical-wolf knife; do not reveal mechanical extra-knife targets. The Poisoner in 盗宝大师 receives no ordinary knife information.
- For a death while play continues, process eligible last words, then legal death skills and the entire resulting chain, then the deceased player's badge if applicable. Each new formal death gets its own victory check before further processing.
- N1 night deaths have last words; ordinary night deaths from N2 onward do not. Daytime exile and daytime gun victims have last words; self-destructing wolves do not. Publish multiple night deaths together; order eligible last words by a random seat and the handbook's odd/even clockwise/counterclockwise convention, skipping ineligible seats.
- Hunters may shoot after normal exile, an ordinary night wolf kill or a same-guard/same-save death (奶死), provided victory has not already ended play. Poison, consecutive dream death and being dragged into death by the Dreamer block the shot.

#### Sheriff election, discussion and voting (§§3–4)

- On D1, run the sheriff election before publishing N1 deaths, unless the match has already ended. If every player stands for election, the badge is lost; if withdrawals leave one candidate, that candidate wins automatically. Withdrawals are irreversible during that election, including any postponement. A withdrawn candidate normally cannot vote in the first sheriff ballot.
- Send all candidates tied at the top of the first sheriff vote to a runoff, with speeches in reverse order of their original election speeches. Former candidates who are not current runoff candidates may vote in the second ballot unless they withdraw during that runoff. A runoff withdrawal leaving one candidate elects that candidate automatically; a second tie loses the badge.
- A legal self-destruct during an unfinished D1 election interrupts it, triggers publication and processing of N1 deaths, then N2. Resume the unfinished election on D2 with the existing speaking order. If another self-destruct interrupts the postponed election, permanently lose the badge, process N2 information and enter N3. When exactly two runoff candidates remain and one self-destructs, elect the other automatically; with three or more, postpone the remaining candidates subject to the one-postponement limit (unless only one remains).
- Without a badge, randomly select a seat and use the odd/even clockwise/counterclockwise convention for speeches. With a sheriff, allow the sheriff to choose the direction relative to the sole night victim (死左/死右), or relative to the sheriff when there are multiple night victims (警左/警右). The sheriff may make a final nomination after ordinary speeches even if their ordinary speech was not last.
- A normal sheriff exile vote has weight 1.5 if it agrees with the sheriff's nomination; otherwise it has weight 1. A sheriff may nominate multiple players into a runoff (weight 1). Exile runoffs use reverse original speaking order, a second ballot with sheriff weight 1 and no second nomination; another tie produces no exile.
- A valid wolf self-destruct ends the normal exile or runoff speech process without automatically exiling any remaining candidate. Close the self-destruct window when the sheriff starts the final nomination, or at formal voting if there is no nomination. When night deaths have not yet been published, publish and process them, last words, death skills and badge handling as applicable before entering the next night, respecting immediate victory.
- A wolf poisoned the preceding night may legally self-destruct before the badge is settled when the rule permits it (自爆吞毒); that wolf cannot participate in the following night's discussion or any wolf night action. A normal self-destructing wolf not restricted by prior lethal effects may participate in the immediately following wolf discussion, but is no longer a living knife holder. Do not give poison a separate death priority or count the wolf's death twice.
- Any sheriff death, including self-destruct, permits badge transfer or destruction only if the game continues and after applicable last words and death chains. The badge may be transferred to anyone not yet formally out, even a player already marked to die in the same resolution.
- Preserve the information encoded by the conventional 警徽流, without requiring the server to enforce truthful signaling: a living Seer/Medium with the badge can signal the predetermined target's result using speech direction. Compare the target's position along each direction from the sole night victim (or the sheriff for multiple deaths), skipping dead seats; the larger position signals 金水, the smaller 查杀, and equal positions use clockwise for 金水 and counterclockwise for 查杀. Once the direction is announced, that information is public even if a wolf then self-destructs. For a night-killed badge holder, destroying the badge signals 金水 and transferring it signals 查杀; the conventional recipient is a surviving previous 金水, otherwise a player the holder considers good. These are player signaling conventions, not forced badge destinations or automatic inspection disclosures.

#### 预女猎白混 (§6.1)

- Use the M1 roster. 混血儿 is a 民 for side elimination regardless of winning affiliation; choose a model on N1 and follow that model's winning affiliation. Track base role, winning affiliation and elimination category separately.
- 白痴／白神 counts as formally removed from the 神 side when exiled; wolves do not need a further knife to eliminate that 神 slot. The exiled player leaves the match and receives the usual exile last words.
- The shared Witch, Seer, Hunter, election and victory requirements apply. Do not assume an additional wolf-gun role in the four-wolf roster without an explicit board decision.

#### 机械狼通灵师 (§§5.2–5.4, 5.6, 6.4)

- Night action order reference: Guard → ordinary small-wolf knife → mechanical ordinary knife (if entitled at night start) → Witch → mechanical learning/copied skill/gun-status confirmation → Medium inspection → Hunter gun-status confirmation. Preserve the information available at each step, even if the internal workflow is simplified.
- Guard may protect self or nobody, including consecutive empty guards. A nonempty target cannot be guarded on consecutive nights; an empty guard breaks that restriction. Keep the target secret from wolves. Ordinary Guard blocks ordinary wolf knives, not poison; legal protection remains effective even if the Guard dies that night.
- When Guard protection and Witch antidote both target the same ordinary knife victim that night, the victim dies (同守同救／奶死), including a mechanical inherited ordinary knife. Treat this as normal night death for Hunter gun eligibility, N1 last words and other normal-night-death passive effects.
- At night start, ordinary knife belongs to the small wolves while any survive; otherwise it belongs to the mechanical wolf. Do not grant a second ordinary knife dynamically if the last small wolf dies during that night.
- The mechanical wolf may learn once per game, on any night, targeting a player who was still in play at night start. Death of that target during the learning night does not invalidate learning; a player already out before the night cannot be learned. The copied identity is fixed. Copied night abilities start the next night, except the copied Hunter gun is effective from the immediately following day and has a night gun-status confirmation.
- Medium inspection of an unlearned mechanical wolf returns 双爪; ordinary small wolves and the double-knife identity return 单爪. After learning, return the corresponding copied/mechanical identity result instead of 双爪. Do not reveal what the mechanical wolf learned to small wolves merely because they share a faction; public knowledge of mechanical type is symmetric between small wolves and good players.
- Mechanical Guard may protect self and cannot guard the same player on consecutive nights. It can block poison and reflects blocked poison onto the Witch, killing her. This differs from ordinary Guard.
- Mechanical Witch has one poison that can be saved for a later night. Mechanical double knife has one storable extra knife, usable only when the mechanical wolf has ordinary knife ownership that night. It penetrates all protection and may target the same player as the ordinary knife. The source of this copied ability still requires an explicit ruling.

#### 盗宝大师 (§§5.5–5.6, 6.3)

- Preserve the M1 14-card/12-seat draw restriction: 蒙面人 always belongs to the good side and is not a Thief draw. No Witch or antidote is present.
- The Thief always belongs to the wolf faction and never contributes to good-side 神 or 民 counts, regardless of disguise. On N1 choose the held 神 or 民 identity; thereafter alternate between them each night. The wolf card is not a switching option. The current identity's skill can be used on the switching night. The Thief cannot self-destruct; small wolves may self-destruct in legal windows.
- No ordinary knife on N1. On subsequent nights, small wolves hold the ordinary knife while any survive; the Thief inherits it at night start after all small wolves are out. No dynamic inheritance during a night. The inherited knife can be used in the same night as the Thief's current legal role skill.
- The Poisoner has one poison, no antidote and no knife-target information. For a Thief with the Poisoner card, an unused poison is available on a Poisoner night and is not replenished by switching.
- Dreamer cannot dream self. A dream target is protected against ordinary knives and poison that night. A Dreamer dying at night drags that night's dream target into death; daytime exile does not drag the target. Two consecutive actual uses of the dream ability on the same target cause dream death, including when a Thief's intervening 民 night separates the uses. Consecutive dream death and death by dragging block Hunter shots.
- A good 蒙面人 exiled by day leaves immediately. If hit by a night lethal effect (ordinary knife, poison, consecutive dream death or death by dragging), formal departure normally occurs after that player's next ordinary daytime speech, not on application of the effect. Check victory at formal departure. When self-destruct removes that speech opportunity and play continues, resolve the delayed departure at night-result publication if it is still pending, or at the interruption if the night result is already public. If the last wolf's self-destruct establishes a good-side win while 蒙面人 is still in play, stop the pending departure immediately. The announcement need not explicitly identify the player as 蒙面人, although the resolution may reveal that identity. N1 蒙面人 does not receive a duplicate N1 last-words speech after their ordinary daytime speech.
- Medium inspection uses the target's identity state at the inspection point. For the Thief, show the current disguise (after switching), not the true wolf faction. Ordinary wolves return 单爪; the handbook mentions 双爪 for a wolf gun, which is not currently specified in the supported roster.
- The handbook's special last-wolf Thief-as-蒙面 rule is outside the current app preset because the Thief cannot draw 蒙面人. Do not implement it as a reachable state unless the draw restriction changes.

### Session and information during play

- The server owns phase transitions, eligibility, and outcomes. Validate the player, action window, and target on each submission. Persist accepted actions and their outcomes before acknowledgement so retries resolve once. Send each phone public state and only its authorized private information. Host controls grant the same visibility as any other seat. Keep night waiting screens generic.
- Extend M1 reconnect to the current phase, private results, and pending legal actions, including after a server restart. Preserve required choices while waiting for reconnect. Pause applicable action timers and resume with the remaining time after the pause clears. Keep private action eligibility out of public disconnect and waiting messages.

### Supplemental gameplay rulings

- 混血儿 chooses any other player on N1. The Seer sees 混血儿 as good. The Witch cannot save herself and may use at most one potion each night.
- 预女猎白混 night order is 混血儿, wolves, 女巫, 预言家, 猎人. 盗宝大师 night order is role switch, 摄梦人, wolves, 毒师, 通灵师, 猎人.
- The first valid submission by a wolf with ordinary knife rights locks that night's shared target or pass. Allow voters to abstain. Publish voter groupings and weighted totals after the last eligible ballot, with no early closure. Preserve a required choice when a player disconnects. If the group cannot continue, the host can confirm ending the match and return everyone to the same room for a new deal.

### Remaining gameplay rulings

- Confirm the mechanical double-knife learning source and full copied-ability/inspection-result mapping, including copied Hunter gun-status timing and eligibility where not specified. Confirm whether any supported roster includes a wolf gun; if so, define its allocation and apply the handbook's gun restrictions.
- Define the pending/formal death boundary around D1 election and 自爆吞毒, including which pending N1 deaths permit an intervening self-destruct. Confirm the no-night-death sheriff direction convention and mixed lethal causes affecting gun eligibility if reachable.
- Confirm role target and skip restrictions, exact mechanical Guard empty-guard behavior, and other unresolved action details before changing them.

### M2 acceptance

- On portrait iPhone Safari and Android Chrome, play from Night 1 through rematch. Verify that the current phase, action, and seat grid remain readable during play.
- Use independent sessions to verify wolf teammate, inspection result, and pending action visibility. Recover a pending private action after a disconnect and a server restart. Retry an accepted action after a lost acknowledgement and verify it resolves once.
- Verify that the host's game controls follow the phase and that an elected sheriff gains only the badge's game powers. Opening help or history and returning keeps the player in the current phase. Verify the public history shows night and day outcomes at the right time and omits private information.
- Verify sheriff candidacy, vote progress, and that results stay unpublished while ballots are outstanding.
- Test a first-vote tie and runoff, sheriff election interruption, badge transfer, N1 last words, and Hunter timing. Exercise immediate night victory and simultaneous victory conditions. Verify 混血儿 affiliation and the 白痴／白神 exile each count correctly.
- Exercise the relevant shared rule boundaries: election withdrawal/runoff eligibility and second ties, sheriff weighting, self-destruct windows and pending-death handling, death/shot/badge ordering, and hidden information timing.
- For 机械狼通灵师, test ordinary Guard empty-guard reset, same-guard/same-save death and Hunter eligibility, mechanical learning timing and visibility, reflected poison, night-start knife inheritance and the extra-knife restriction once its learning source is agreed.
- For 盗宝大师, test both starting identities, mandatory switching and persistent skill resources, disguise inspections, N1 no-knife and subsequent inheritance, dream protection/dragging/consecutive-use death across switching, and good 蒙面 delayed departure. Verify that a good-side win after the last wolf self-destructs before dawn publication cancels the pending departure. Verify that the excluded Thief-as-蒙面 state cannot arise.

## M3. Spectating and seat replacement

- When all 12 seats are occupied, offer new guests 观战 from the same room invite or code, including during a match. Restore an existing player's session before offering spectator entry.
- Spectators are account-free and use no seat. A room can keep up to 24 spectator sessions. Show them only public room and match information at the same publication points as players. Spectators can request to replace an offline player and cancel their own request.
- A spectator selects an occupied, disconnected seat during setup or active play. Only the room host can approve the request. The host’s seat is excluded. The server checks that the seat is still held by the same offline player and that the spectator is online. A player reconnecting before approval clears requests for their seat.
- On approval, move the spectator into that seat and keep the deal, game state, and pending choices attached to it. If the deal has happened and play has yet to begin, the replacement reviews and confirms the role before the match starts. During play the replacement gains the seat’s private view and legal actions immediately. The original session becomes a spectator and, once roles are dealt, cannot request another seat until rematch. The replacement keeps the seat on rematch.
- Verify that a guest can spectate a full lobby and a match in progress without seeing private roles, pending actions, or unreleased votes. Verify that a returning player keeps their seat if they reconnect first, and that an approved handoff survives retry and restart. Use independent sessions to check that only the replacement can resume the seat’s private action.

## Later candidates

| Board | Gameplay additions | Handbook reference |
| --- | --- | --- |
| 假面舞会 | Hidden wolf, dance pool, and mask interactions. | §6.2 |
| 预女骑守 | Knight duel and Guard interactions. | §6.5 |

Custom lineups, bot rehearsal, personal notes, narration, and in-app chat or voice are candidates for later playtests. Rankings, profile navigation, links to other games, feedback, and decorative cover images are optional widgets. Host handoff, redeal during setup, and manual elimination are candidates for recovery tools. Define their permitted phases and effects before adding them.
