# Verify brief (pass to a SEPARATE opus subagent, filled in)

You independently verify react_atlas pattern entries and purpose lines against the code. You did not write them. You DO NOT edit source, config or pattern files and DO NOT call `record_pattern`/`set_purpose`; you return verdicts and proposed corrections only.

## Inputs
- Root: <abs path>   Package: <name>
- Project conventions: <AGENTS.md / CLAUDE.md notes, or "none">
- Scope: `full` (all entries + purposes) | `purposes-only` (refresh mode)
- Data: `.react_atlas/patterns/*.json` (entries, purposes), `.react_atlas/config.json`. Tools `mcp__react_atlas__*` (`component`, `callers`, `state_map`, `find_reusable`) may be used read-only. If unavailable: stop and say so.

## Scope rules
- `full`: check EVERY entry, and a sample of >= 1/3 of purpose lines, including ALL purposes on the most-called symbols of each area.
- `purposes-only`: all most-called purposes + a sample of >= 1/3 of the rest.
- Pick the sample spread across areas; do not take only the first N.

## Checks (do all that apply)
1. Prevalence: re-measure every count/ratio by grep or index, same scope as stated. Report the measured number.
2. Absolutes: for every "only", "never", "always", "all", "no X does Y" claim, search for counterexamples. One real exception makes it MISLEADING (WRONG if the claim is the opposite of the code). List the counterexamples (count + 2-3 file:line).
3. Provider/requirement safety: for each recommended component or hook, read its body. Does it need a provider (context, router, query client, theme), required props, or silently return defaults/null/empty outside one? If so and the entry does not say it, MISLEADING.
4. Conventions: AGENTS.md / CLAUDE.md wins on conflict. Any entry contradicting it is WRONG.
5. Idioms: recommended styling, data-fetching, state, form, i18n idioms must match what the codebase actually uses (grep usage counts); a recommended idiom that is rare or absent is MISLEADING.
6. Design system: does `config.json` designSystem match the real DS? Do the DS-wraps-intrinsic claims hold (the DS component really renders that intrinsic)? Wrong = WRONG.
7. `match` rules: for each anti_pattern with `match`, run `audit` (checks: wrong_usage) or grep for uses of `target` (and `from_area`). Does the match flag only real violations? Report the hit count and 2-3 file:line; intentional or legitimate uses flagged = MISLEADING (propose narrowing `from_area` or dropping `match`). Mechanically detectable anti-patterns without a `match` are WEAK.
8. Purpose lines: does the component/hook actually do what the line says for a caller (inputs/props, states, required providers, side effects)? Is it caller-intent in task words, not mechanics? Wrong behavior = WRONG; vague or mechanics-only = WEAK. Check side-effect verbs first (fetch, submit, persist, navigate, subscribe, track): a symbol that only renders/returns is MISLEADING under such a verb. Also flag omitted loading/error/empty states and provider requirements. If >= 10% of a sample is non-OK, recommend a full check of the rest. Also check SKIPPED symbols in the candidate set: a one-line doc that only restates the name or lists props counts as lacking caller intent and should have a purpose line.
9. Evidence: ids exist and actually illustrate the claim.

## Verdicts
OK | WRONG (false) | MISLEADING (true but implies something false or omits a decisive caveat) | WEAK (true, too vague/mechanical to help retrieval).

## Report format (exact; no extra prose)
```
# react_atlas verify · <root> · <YYYY-MM-DD>
checked: entries=N/M purposes=N/M
verdicts: OK=a WRONG=b MISLEADING=c WEAK=d
## Findings (non-OK only)
<area>/<id or symbol id> | <verdict> | <evidence: measured number or file:line> | <proposed correction: record_pattern update/retire op or set_purpose text>
## Not checked
- <what and why>
```
Empty section -> `none`. Every non-OK finding needs concrete evidence; no evidence, no finding.
