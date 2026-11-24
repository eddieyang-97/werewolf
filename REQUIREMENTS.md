# Werewolf requirements

M1 delivers room setup and private role distribution. M2 adds a complete playable match. M3 adds spectating for full rooms. The [狼人杀规则手册 v18.1, 2026-10-21](docs/rules/werewolf_rules_v18.1_2026-10-21.pdf) governs game rules. Board-specific provisions take precedence. Record any additional rulings before implementing the affected behavior.

## Product and interface

Build a mobile browser app for friends playing at the same table or talking on a separate call. Each player uses their own phone. The host also plays. Use Fengsheng’s invite, seating, and reconnect flows as references.

- Target portrait iPhone Safari and Android Chrome. An invite opens directly in the browser. Provide touch-friendly actions, clear room status, and an accessible seat grid that fits narrow screens without horizontal scrolling.
- Use Simplified Chinese for player-facing copy as a working assumption.
- Match the supplied [米多狼人面杀助手 screenshots](docs/ui-references/README.md) for the M1 screens, including the layout, typography, palette, and supplied artwork. Use browser-native phone chrome and keep the account-free nickname steps.

## M1. Room setup and private role distribution

### Board presets

| Preset | Twelve seats | Handbook |
| --- | --- | --- |
| 机械狼通灵师 | 3 小狼 and 1 机械狼, 4 神 (通灵师、女巫、守卫、猎人), and 4 村民. | §6.4 |
| 预女猎白混 | 4 狼人, 4 神 (预言家、女巫、猎人、白痴／白神), and 4 民 (3 村民 and 1 混血儿). | §6.1 |
| 盗宝大师 | 3 小狼 and 1 盗宝大师, 4 ordinary 神, and 4 村民. The 盗宝大师 seat also holds one randomly assigned 神 card and one 村民 card. | §6.3 with the draw restriction below |

For **盗宝大师**, draw its 神 card once per deal from 毒师、摄梦人、猎人、通灵师. The eligible cards are equally likely. The draw and seat assignments are saved together and restored on retry or reconnect. The handbook's 12-seat deal uses 14 cards, with 盗宝大师 holding a wolf card and the two extra cards.

蒙面人 always goes to an ordinary 神 seat. The three eligible cards that 盗宝大师 did not draw fill the other ordinary 神 seats. Shuffle those four cards among the ordinary 神 seats.

### Room flow

1. **Create and share.** The host previews the board and creates a room. The lobby provides an 邀请好友 action that opens the phone's share sheet when available and offers a copy-link option. The link identifies the room and can be pasted into a group chat.
2. **Enter the room.** Tapping an invite opens that room directly. A returning player with a valid room credential resumes their session automatically. A new guest enters their nickname on the room screen, then sees the lobby and public role counts. When all seats are taken, show new guests that the room is full until M3 adds spectating. The home screen's 加入房间 action also supports entry with a short room code.
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

Apply the board-specific rules for the three M1 presets. Implement 机械狼 learning and copied abilities under §§5.4 and 6.4. Implement 盗宝大师 switching, ability timing, inspection, and formal death under §6.3 with the M1 draw restriction. The rules below cover shared behavior and the additions for 预女猎白混.

| Area | Requirement |
| --- | --- |
| Death and victory | Check both win conditions at each formal death or simultaneous resolution. Wolves win when every power-role or every civilian seat has formally left. The good side wins when all wolves are eliminated. Wolves win if the final wolf and final member of a required good-side category die in the same related resolution. End immediately on a win, even at night, and stop pending last words, shots, death abilities, and badge transfers. §§1–2 |
| Night | Collect authorized wolf and role actions privately. Resolve actions against the whole night. A lethal effect applied earlier in the action order generally leaves the affected role’s legal night action intact. Public death announcements are distinct from formal death resolution. On boards with a Witch, show her the normal wolf target while the antidote remains. §§1, 4.3, 5.1, 5.4 |
| 混血儿 and 白痴／白神 | Track role card, elimination category, and winning affiliation independently. 混血儿 chooses a model on N1 and follows their winning affiliation while counting toward the civilian elimination category. 白痴／白神 counts as having left the power-role category on exile. §6.1 |
| Day 1 sheriff election | Run candidacy, withdrawals, speaking, voting, and any election runoff before announcing N1 deaths, subject to immediate victory and interruption rules. Support the single-candidate result, badge loss, voter eligibility, and one permitted postponement on wolf self-destruct. §§1, 3.1–3.3, 4.3 |
| Discussion and badge | Support random speaking order without a badge, sheriff direction choices, final nomination, conditional 1.5-vote weighting, and badge transfer or destruction. Keep Seer results private. Let players convey them in play through the permitted speech direction or badge choices. §§3.4–3.6 |
| Exile and wolf self-destruct | A tied first exile vote sends all tied targets to a runoff with reverse speaking order and a second vote. A second tie leaves everyone in. A legal wolf self-destruct interrupts discussion or runoff speeches and advances play according to the pending death announcements and resolution rules. Enforce the closing window at the start of the sheriff’s final nomination, or formal voting when there is no nomination. §4 |
| Last words and Hunter | Follow the order formal death → victory check → eligible last words → legal shots and death chains → badge handling. Give eligible N1 deaths last words, handle multiple deaths in the specified speaking order, and apply daytime last-words eligibility. Allow Hunter shots after normal exile or a normal wolf kill where play continues. Poison blocks the shot. §§1–2 |

### Session and information during play

- The server owns phase transitions, eligibility, and outcomes. Validate the player, action window, and target on each submission. Persist accepted actions and their outcomes before acknowledgement so retries resolve once. Send each phone public state and only its authorized private information. Host controls grant the same visibility as any other seat. Keep night waiting screens generic.
- Extend M1 reconnect to the current phase, private results, and pending legal actions, including after a server restart. Preserve required choices while waiting for reconnect. Pause applicable action timers and resume with the remaining time after the pause clears. Keep private action eligibility out of public disconnect and waiting messages.

### Supplemental gameplay rulings

- 混血儿 chooses any other player on N1. The Seer sees 混血儿 as good. An exiled 白痴／白神 leaves the match, counts as eliminated on the power-role edge, and receives the usual exile last words. The Witch cannot save herself and may use at most one potion each night.
- 预女猎白混 night order is 混血儿, wolves, 女巫, 预言家, 猎人. 盗宝大师 night order is role switch, 摄梦人, wolves, 毒师, 通灵师, 猎人. The Thief chooses a starting form on N1 and switches automatically on later nights. Skip the first-night ordinary wolf knife on 盗宝大师. Use §5.4 for 机械狼通灵师.
- The first valid submission by a wolf with ordinary knife rights locks that night's shared target or pass. Allow voters to abstain. Publish voter groupings and weighted totals after the last eligible ballot, with no early closure. Preserve a required choice when a player disconnects. If the group cannot continue, the host can confirm ending the match and return everyone to the same room for a new deal.

### M2 acceptance

- On portrait iPhone Safari and Android Chrome, play from Night 1 through rematch. Verify that the current phase, action, and seat grid remain readable during play.
- Use independent sessions to verify wolf teammate, inspection result, and pending action visibility. Recover a pending private action after a disconnect and a server restart. Retry an accepted action after a lost acknowledgement and verify it resolves once.
- Verify that the host's game controls follow the phase and that an elected sheriff gains only the badge's game powers. Opening help or history and returning keeps the player in the current phase. Verify the public history shows night and day outcomes at the right time and omits private information.
- Verify sheriff candidacy, vote progress, and the waiting path when ballots are outstanding. Exercise confirmed early close wherever the agreed ballot policy permits it.
- Test a first-vote tie and runoff, sheriff election interruption, badge transfer, N1 last words, and Hunter timing. Exercise immediate night victory and simultaneous victory conditions. Verify 混血儿 affiliation and the 白痴／白神 exile each count correctly.

## M3. Spectating

- When all 12 seats are occupied, offer new guests 观战 from the same room invite or code, including during a match. Restore an existing player's session before offering spectator entry.
- Spectators are account-free and use no seat. Show them only public room and match information at the same publication points as players. A spectator's session has read-only access.
- Verify that a new guest can spectate a full lobby and a match in progress. Check that spectator entry leaves the roster and deal unchanged, that returning players keep their seats, and that spectators receive no private roles, pending actions, or unreleased votes.

## Later candidates

| Board | Gameplay additions | Governing section |
| --- | --- | --- |
| 假面舞会 | Hidden wolf, dance pool, and mask interactions. | §6.2 |
| 预女骑守 | Knight duel and Guard interactions. | §6.5 |

Custom lineups, bot rehearsal, personal notes, narration, and in-app chat or voice are candidates for later playtests. Rankings, profile navigation, links to other games, feedback, and decorative cover images are optional widgets. Host handoff, redeal during setup, and manual elimination are candidates for recovery tools. Define their permitted phases and effects before adding them.
