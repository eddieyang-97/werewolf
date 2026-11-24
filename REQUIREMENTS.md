# Werewolf requirements

Draft for the first friends-only playtest. The [狼人杀规则手册 v18.1, 2026-10-21](docs/rules/werewolf_rules_v18.1_2026-10-21.pdf) governs game rules. Board-specific provisions take precedence. Record any additional rulings before implementing the affected behavior.

## First playtest

Build a mobile browser game for friends playing at the same table or talking on a separate call. Each player uses their own phone. The host also plays. The app deals private roles, guides discussion and voting, runs night actions, and resolves deaths and victory. Use Fengsheng’s invite, seating, and reconnect flows as references and give Werewolf its own visual design.

- Target portrait iPhone Safari and Android Chrome. An invite opens directly in the browser. Provide touch-friendly actions, a clear phase indicator, and an accessible seat grid that fits narrow screens without horizontal scrolling.
- Use Simplified Chinese for player-facing copy as a working assumption.
- Start with one official 12-player board. **预女猎白混** is the proposed first board. Use guest nicknames, a shareable invite, and a short room code.

## Player flow

1. **Create or join.** The host picks a board and shares the invite or code. Each friend joins with a nickname and sees the public role counts.
2. **Take a seat.** Players choose a vacant numbered seat and can stand before the deal. Everyone sees occupied, vacant, and disconnected seats. The host locks the roster and deals once all seats are occupied and connected.
3. **Reveal and ready.** Each player taps to privately view their role and ability, then marks ready. They can reopen their card. The host starts Night 1 once everyone is ready and connected. Refreshing or reopening the recent room restores the seat with the existing session.
4. **Play the round.** Each phone shows the current phase, round, and seat status. The app prompts eligible players privately, shows the current speaker and public announcements, and collects votes in the applicable election, exile, and runoff windows. The host can advance spoken discussion and last words.
5. **Review and play again.** Everyone sees the winner, full role roster, and public round history. The host can return to the same room and seats for a fresh deal.

## Board coverage

| Board | First playtest scope | Governing section |
| --- | --- | --- |
| 预女猎白混 | Proposed first board. Four wolves, four power roles (预言家、女巫、猎人、白痴／白神), and four civilian seats (three 村民 and one 混血儿). | §6.1 |
| 假面舞会 | Later. Hidden wolf, dance pool, and mask interactions. | §6.2 |
| 盗宝大师 | Later. Fourteen cards across twelve seats, identity switching, and delayed death. | §6.3 |
| 机械狼通灵师 | Later. Mechanical Wolf learning, copied abilities, and Spiritualist inspection. | §6.4 |
| 预女骑守 | Later. Knight duel and Guard interactions. | §6.5 |

### Rules required for 预女猎白混

| Area | Requirement |
| --- | --- |
| Death and victory | Check both win conditions at each formal death or simultaneous resolution. Wolves win when every power-role or every civilian seat has formally left. The good side wins when all wolves are eliminated. Wolves win if the final wolf and final member of a required good-side category die in the same related resolution. End immediately on a win, even at night, and stop pending last words, shots, death abilities, and badge transfers. §§1–2 |
| Night | Collect authorized wolf and role actions privately. Resolve actions against the whole night. A lethal effect applied earlier in the action order generally leaves the affected role’s legal night action intact. Public death announcements are distinct from formal death resolution. Show the Witch the normal wolf target while the antidote remains. §§1, 4.3, 5.1, 5.4 |
| 混血儿 and 白痴／白神 | Track role card, elimination category, and winning affiliation independently. 混血儿 chooses a model on N1 and follows their winning affiliation while counting toward the civilian elimination category. 白痴／白神 counts as having left the power-role category on exile. §6.1 |
| Day 1 sheriff election | Run candidacy, withdrawals, speaking, voting, and any election runoff before announcing N1 deaths, subject to immediate victory and interruption rules. Support the single-candidate result, badge loss, voter eligibility, and one permitted postponement on wolf self-destruct. §§1, 3.1–3.3, 4.3 |
| Discussion and badge | Support random speaking order without a badge, sheriff direction choices, final nomination, conditional 1.5-vote weighting, and badge transfer or destruction. Keep Seer results private. Let players convey them in play through the permitted speech direction or badge choices. §§3.4–3.6 |
| Exile and wolf self-destruct | A tied first exile vote sends all tied targets to a runoff with reverse speaking order and a second vote. A second tie leaves everyone in. A legal wolf self-destruct interrupts discussion or runoff speeches and advances play according to the pending death announcements and resolution rules. Enforce the closing window at the start of the sheriff’s final nomination, or formal voting when there is no nomination. §4 |
| Last words and Hunter | Follow the order formal death → victory check → eligible last words → legal shots and death chains → badge handling. Give eligible N1 deaths last words, handle multiple deaths in the specified speaking order, and apply daytime last-words eligibility. Allow Hunter shots after normal exile or a normal wolf kill where play continues. Poison blocks the shot. §§1–2 |

## Session and information rules

- The server owns the deal, phase transitions, eligibility, and outcomes. Each phone receives public state and only the private details its seat may know. The host’s management controls use the same visibility rules as any other seat. Keep night waiting screens generic and reveal the full role roster at game end.
- Validate the player, action window, and target on every submission. Concurrent seat claims, repeated taps, and stale commands must leave all phones in agreement.
- A refresh or disconnect preserves the seat and restores pending actions when the original session returns. Once roles are dealt, a code or nickname alone cannot recover a seat. Show the host the public connection state. Decide how to handle stalled private actions without exposing who can act or assigning a default to a required choice without a ruling.

## Decisions before implementing game rules

- Confirm **预女猎白混** as the first board and settle details §6.1 leaves implicit, including 混血儿 target eligibility and what 白痴／白神 can do after exile.
- Specify the first board’s exact night prompt order, how wolves submit a shared choice, the Witch’s potion and self-save limits, and the Seer’s result for 混血儿. The night order in §5.4 is for 机械狼通灵师.
- Set vote visibility and abstention behavior where the handbook is silent. Decide recovery for a disconnected player with a required choice, including how the group resumes or abandons the round.

## Playtest acceptance

- On iPhone Safari and Android Chrome, friends can join through a link or code, claim seats, and complete a round from deal through rematch.
- Independent sessions verify role cards, wolf teammates, inspection results, and pending actions are visible only to the appropriate seats. Refreshing during a private action restores that seat and its legal choices.
- Test a first-vote tie and runoff, sheriff election interruption, badge transfer, N1 last words, and Hunter timing. Exercise immediate night victory and simultaneous victory conditions. Verify 混血儿 affiliation and the 白痴／白神 exile each count correctly.

Custom lineups, the remaining boards, bot rehearsal, narration, spectators, and in-app chat or voice are candidates for later playtests.
