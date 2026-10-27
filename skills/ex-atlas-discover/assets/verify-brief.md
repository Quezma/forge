# Verify brief (pass to a SEPARATE opus subagent, filled in)

You independently verify ex_atlas pattern entries and purpose lines against the code. You did not write them. You DO NOT edit source or pattern files and DO NOT call `record_pattern`/`set_purpose`; you return verdicts and proposed corrections only.

## Inputs
- Root: <abs path>   App ns: <MyApp>
- Project conventions: <AGENTS.md / CLAUDE.md notes, or "none">
- Scope: `full` (all entries + purposes) | `purposes-only` (refresh mode)
- Data: `.ex_atlas/patterns/*.json` (entries, purposes). Tools `mcp__ex_atlas__*` (`module`, `callers`) may be used read-only. If unavailable: stop and say so.

## Scope rules
- `full`: check EVERY entry, and a sample of >= 1/3 of purpose lines, including ALL purposes on root context modules of each area.
- `purposes-only`: all root-context purposes + a sample of >= 1/3 of the rest.
- Pick the sample spread across areas; do not take only the first N.

## Checks (these caught real problems; do all that apply)
1. Prevalence: re-measure every count/ratio by grep or index, same scope as stated. Report the measured number.
2. Absolutes: for every "only", "never", "always", "all", "no X does Y" claim, search for counterexamples. One real exception makes it MISLEADING (WRONG if the claim is the opposite of the code). List the counterexamples (count + 2-3 file:line).
3. Reader/writer safety: for each recommended helper, read its body. Does it require an open tenant transaction / connection state, or silently return defaults/nil/empty outside one? If so and the entry does not say it, MISLEADING.
4. Conventions: AGENTS.md / CLAUDE.md wins on conflict. Any entry contradicting it is WRONG.
5. Idioms: recommended time/clock/ID/randomness idioms must match what the codebase actually uses (grep usage counts); a recommended idiom that is rare or absent is MISLEADING.
6. Purpose lines: does the function actually do what the line says for a caller (inputs, error shape, side effects)? Is it caller-intent in task words, not mechanics? Wrong behavior = WRONG; vague or mechanics-only = WEAK. Check side-effect verbs first (emit, send, schedule, enqueue, mark, persist): a function that only builds/returns the thing is MISLEADING under such a verb. Also flag omitted status/disabled/inactive outcomes and raises. If >= 10% of a sample is non-OK, recommend a full check of the rest. Also check SKIPPED functions in the candidate set: a one-line @doc that only restates the name, or only states the return shape (e.g. "`%{id => total}` for the given ids."), counts as lacking caller intent and should have a purpose line.
7. Evidence: ids exist and actually illustrate the claim.

## Verdicts
OK | WRONG (false) | MISLEADING (true but implies something false or omits a decisive caveat) | WEAK (true, too vague/mechanical to help retrieval).

## Report format (exact; no extra prose)
```
# ex_atlas verify · <root> · <YYYY-MM-DD>
checked: entries=N/M purposes=N/M
verdicts: OK=a WRONG=b MISLEADING=c WEAK=d
## Findings (non-OK only)
<area>/<id or function id> | <verdict> | <evidence: measured number or file:line> | <proposed correction: record_pattern update/retire op or set_purpose text>
## Not checked
- <what and why>
```
Empty section -> `none`. Every non-OK finding needs concrete evidence; no evidence, no finding.
