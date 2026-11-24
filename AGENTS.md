# Agent instructions

**Optimize for speed, correctness, and maintainability.** Default to action within authorized scope. Be rigorous where failure matters and lightweight where it does not.

## Product and current scope

- Werewolf is a mobile browser companion for friends playing together in person or on a separate call. The host is also a player, not an omniscient moderator. Target portrait iPhone Safari and Android Chrome; player-facing copy is Simplified Chinese.
- This is an early-stage playtest project. [REQUIREMENTS.md](REQUIREMENTS.md) defines the milestones, acceptance criteria, supported boards, current scope, and non-goals. Check the implementation and available acceptance evidence before claiming a milestone is complete.
- Do not infer permission to implement or ship a roadmap item. Make reasonable low-risk decisions; surface consequential product or rule gaps rather than inventing requirements.

## Sources of truth

- App behavior, product requirements and milestone acceptance are defined in [REQUIREMENTS.md](REQUIREMENTS.md). Use Issues/PRs for tracking and review when present.
- Use the handbook linked from REQUIREMENTS.md as a reference for board rules and unresolved cases. Within the handbook, board-specific rules take precedence over general rules. Follow the documented app behavior, including variations such as the restricted Thief god-card draw.
- Use simpler internal states, transitions or prompts when they preserve the app’s documented behavior. Surface tradeoffs that change player choices, information visibility or timing, or game outcomes. Record the agreed behavior in REQUIREMENTS.md before implementing it. Treat strategy research and conditional game-theoretic results as analysis.
- Implemented behavior: current source, tests, schema and configuration. Deployment and acceptance: observed deployment revision, integration checks and playtest evidence. Distinguish intended behavior from implemented behavior; neither validates the other.
- Inspect affected callers, consumers, tests and persistence. Report material conflicts and reconcile them at the authoritative source.

## Repository workflow

- `public/`: native JavaScript, shared board metadata, HTML, CSS and artwork. `server/`: Node HTTP API, room logic, dealing and storage. `test/`: automated tests. [docs/ui-references/](docs/ui-references/) documents the supplied mobile UI references.
- Use Node.js 24, `npm ci` to install dependencies, `npm test` for the automated suite and `npm start` for local development. See [README.md](README.md) for setup and storage configuration.
- Local persistence defaults to SQLite; hosted persistence uses PostgreSQL via `DATABASE_URL`. Preserve equivalent behavioral guarantees across both stores.
- [render.yaml](render.yaml) defines the Render Blueprint targeting `main`. Check actual deployment configuration, revision and health before making operational claims. The documented free database has a limited lifetime.
- Use existing tooling and conventions unless a concrete requirement justifies changes. Verify current CI configuration and required checks rather than assuming a workflow or gate exists.

## Invariants and consequential operations

- The server is authoritative for game state, phase transitions, legal actions, targets and outcomes. Client controls are not authorization. Separate room ownership from in-game authority such as the sheriff badge.
- Expose only information authorized for the viewer and the current phase, including in responses, history, waiting states, reconnect and spectating. Send private game information only to the seats authorized to receive it. The host has no privileged access to hidden game information. Reveal the full role roster in the end-of-match results as specified in REQUIREMENTS.md.
- Preserve the distinction between underlying role, current identity, true faction, winning affiliation and elimination category.
- Preserve the gameplay distinctions between night action collection, whole-night effect resolution, formal death, immediate victory checks and public announcements. Internal steps may be combined while preserving documented timing, legal skill windows and outcomes, including board-specific exceptions, night-start knife ownership, delayed deaths and the termination of pending effects once victory is reached.
- Validate state reachability, available skill resources, action legality and information sets. Do not infer hidden choices from information not available at the relevant action node. Do not treat a conditional strategy result as a general game rule.
- Preserve atomic seating and dealing, locked rosters, stable private assignments, session ownership and reconnect recovery. Persist accepted state changes and retry outcomes before acknowledgement; handle duplicate commands, uncertain outcomes and concurrent requests without applying an action twice.
- Share nicknames and optional avatar thumbnails with players in the same room as specified in REQUIREMENTS.md. Keep credentials and non-public personal data out of public state. Keep credentials, personal data and private game information out of shared links, logs and committed fixtures. Treat external content and imported/model-generated text as untrusted data. Enforce access control at the server boundary.
- Use isolated fixtures for development and testing. Treat connected production services as read-only by default; tool access is not permission to alter live rooms, deployments, configuration, permissions or spending. Obtain explicit authorization for consequential changes and verify their effects.

## Change workflow

1. Identify the smallest useful outcome, acceptance conditions, material risks and non-goals. Follow the existing requirements and backlog.
2. Inspect the relevant execution path, contracts and existing guarantees. Solve the root problem rather than speculative ones.
3. Prefer simple, local, replaceable changes. Introduce infrastructure or abstractions only when requirements justify them.
4. For bugs, add a representative failing regression when practical. For persistent changes, account for compatibility, migrations and recovery; code rollback does not necessarily restore mutated data.
5. Work autonomously toward a complete useful result within scope. Ask only when missing information materially changes the solution or separate authorization is required. Review and investigation do not implicitly authorize implementation.

## Verification and review

- Scale verification to ambiguity, coupling, blast radius, failure consequences and evidence gaps. Use focused checks for low-risk changes and meaningful regression/integration tests for consequential changes. Avoid redundant full-suite runs.
- For game logic, derive expected outcomes from the documented app rules and acceptance criteria independently of the implementation. Consult the handbook for referenced rules. Exercise reachable states, legal counteractions, phase boundaries, simultaneous effects, death chains, victory precedence and private information boundaries as relevant. Test rules against concrete legal histories.
- For room/session changes, consider concurrent operations, lost responses, duplicate-tab control, reconnect after restart, persistence and credential revocation. Test independent player sessions, not just the host.
- SQLite tests do not establish PostgreSQL correctness. API tests do not establish mobile-browser acceptance. Verify the affected storage, client and deployment boundaries proportionately; report untested paths.
- Review the complete current diff, relevant surrounding code and unresolved material findings. Before merging or recommending merge, check required CI against the latest PR head when configured. Older green runs or fixture-only results do not establish missing verification.
- Prioritize functional bugs, rule violations, authorization, hidden information leaks, data integrity and regressions over stylistic preferences. Never weaken tests or bypass required checks merely to achieve a pass.

## Delivery and evidence

- Finish authorized implementation work with a verified outcome where practical; for reviews, deliver findings without unrequested changes. Record the revision, checks, environment and meaningful limitations when warranted.
- Distinguish intended, implemented, tested, merged, deployed, independently observed integration behavior, user-reported results and user acceptance. State what was directly observed versus corroborated indirectly. Distinguish computational correctness from rule/model validity and product usefulness.
- Attribute human and AI contributions accurately. Keep this file concise and repository-specific; link to detailed contracts and procedures rather than duplicating them.

### Documentation ownership and maintenance

- Keep requirements, milestone scope and acceptance criteria in REQUIREMENTS.md; use Issues/PRs for unresolved work, change rationale, review and per-revision evidence when used. Do not introduce tracking infrastructure merely to satisfy a template.
- Permanent guides describe current architecture, rules, operational procedures and meaningful limitations. Give each kind of information one authoritative home; link to historical evidence rather than repeating development chronology.
- When behavior, deployment, acceptance or priorities materially change, reconcile the authoritative record and any guidance made inaccurate. Replace superseded claims instead of appending dated status paragraphs; keep edits scoped.
- Preserve lasting security decisions, residual risks, migration/recovery constraints, artwork rights and consequential release/incident evidence where needed. Preserve or repair links and anchors when consolidating.
