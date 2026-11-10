# Scouting contract

A scouting contract tells the system what to collect for one kind of observation: `match`, `pit` or `general`. Each team's builder authors it. LLM extraction, deterministic validation, follow-up questions and data consumers all read the same published document. Scouts still send free-form Telegram messages and linked replies. The contract configures collection only. It does not define calculated statistics or a scout web form.

The code is in `packages/scouting`:

- `contract.ts`: schema, `validateContract`, `readContract`, identity contracts and the format 1 upgrade.
- `rules.ts`: `checkAnswer`, `evaluateAnswers` and `foldTurns`.
- `examples/`: worked match, pit and general contracts. Tests use them.

Telegram extraction uses the contract for match, pit and general scouting (#48). See [extraction](#extraction). Team admins author, publish and assign contracts in the [specification builder](web-app.md#specification-builder-47) (#47), which uses the [specification API](web-app.md#scouting-specifications-46) (#46).

## Versions

Two version values exist. Do not mix them up.

- **Contract format version** (`formatVersion`): the shape of the document. The current format is `2`. A document without `formatVersion` is format 1, the original starter shape.
- **Publication identity**: organization, season, kind and `version`, stored in `published_specification`. Publications are immutable. Sessions and observations keep the publication they were assigned.

`readContract(document, kind)` reads any stored publication. It reads format 1 documents with their original semantics: `text` stays unbounded text, `integer` becomes an integer with `min: 1`, `boolean` stays boolean, and nothing is conditional. It does not change the stored document. An unknown format, an unknown answer type or an invalid document causes an error. Readers never drop questions they do not understand.

## Document

```json
{
  "formatVersion": 2,
  "kind": "match",
  "version": "team-match-v3",
  "description": "Admin-facing description.",
  "questions": [ ... ]
}
```

Questions are ordered. Follow-ups use this order, with identity questions first. Each question has these fields:

| Field      | Audience | Purpose                                                                                      |
| ---------- | -------- | -------------------------------------------------------------------------------------------- |
| `key`      | System   | Stable code. Answers, rules and consumers use it. Lowercase letters, digits and underscores. |
| `label`    | People   | Short readable name. You can change it without changing stored data.                         |
| `prompt`   | Scouts   | Follow-up question wording sent in Telegram.                                                 |
| `guidance` | Model    | Extraction instructions. Scouts never see it.                                                |
| `required` | System   | Base requirement before rules apply.                                                         |
| `answer`   | System   | Answer type and constraints.                                                                 |
| `rules`    | System   | Optional conditional behaviour.                                                              |

Do not reuse a code with a different meaning in a later version. Consumers interpret values with the publication that recorded them.

## Answer types

| Type              | Constraints                                                  | Known value                                                                             |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `number`          | `format`: `integer` or `decimal`. Optional `min` and `max`.  | A finite number within bounds. `0` is valid when the bounds allow it.                   |
| `text`            | Optional `maxLength`, up to 20,000.                          | Trimmed text that is not empty. Whitespace only is unknown.                             |
| `boolean`         | None                                                         | `true` or `false`. Explicit `false` is an answer.                                       |
| `single_choice`   | 2 to 50 `options`, each with `code` and `label`.             | One option code.                                                                        |
| `multiple_choice` | 1 to 50 `options`. Optional `minSelected` and `maxSelected`. | A list of unique option codes. `[]` means "none of these" when `minSelected` allows it. |

`null` or a missing value is always unknown. Unknown is never false, zero or a default choice. `checkAnswer` returns `known`, `unknown` or `invalid` with a reason. An invalid value, such as an out-of-range number or an unlisted option, is never coerced into a valid one.

Option codes are stable. Option labels can change.

### Adding a type

Add a new member to the `answer` discriminated union. Add it to `answerTypes`, `operatorsByType` and `checkAnswer`, and add validator tests. Readers built before the new type reject documents that use it (`unsupported_type`). Increase `formatVersion` only when the meaning of an existing field changes. Then add an upgrade path similar to the format 1 upgrade.

## Rules

Rules are data attached to a question. They are not answer types and not executable expressions.

```json
{ "effect": "show", "when": { "question": "climbed", "operator": "equals", "value": true } }
```

`effect` is one of these:

- `show`: the question applies only when the condition is true.
- `hide`: the question does not apply when the condition is true.
- `require`: an optional question becomes required.
- `optional`: a required question becomes optional.

`when` is a comparison or a group. Groups are `{ "all": [...] }` or `{ "any": [...] }`, with 1 to 20 items, up to 4 levels deep.

| Upstream type     | Operators                                        | Value                               |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| `boolean`         | `equals`, `not_equals`                           | `true` or `false`                   |
| `number`          | `equals`, `not_equals`, `lt`, `lte`, `gt`, `gte` | A number                            |
| `single_choice`   | `equals`, `not_equals`                           | One option code                     |
| `single_choice`   | `in`, `not_in`                                   | A list of option codes              |
| `multiple_choice` | `includes`, `excludes`                           | One option code                     |
| `text`            | None                                             | Free text is not a condition source |

### Evaluation and precedence

Evaluation uses three values: true, false and unknown.

1. A comparison is unknown when the upstream answer is unknown or invalid, or when the upstream visibility is unknown.
2. A comparison on a hidden upstream question is false. Hidden answers do not apply.
3. `all` is false if any item is false, otherwise unknown if any item is unknown, otherwise true. `any` is the opposite.
4. Rules with the same effect combine with "any".
5. Visibility: with `show` rules, visible = any show rule. With `hide` rules, visible = not any hide rule. With neither, visible.
6. Requirement applies only to visible questions. Hidden questions are never required. A required question can only have `optional` rules, and an optional question can only have `require` rules. So the requirement is the base value, flipped when an opposing rule is true, and unknown when that rule is unknown.

The validator rejects show and hide rules on the same question, and rules that repeat the base requirement. Thus no runtime conflicts between effects exist.

### Unknown conditions and follow-ups

`evaluateAnswers(contract, values)` gives each question a visibility, a requirement and a state:

| State        | Meaning                                                                  | Blocks completion                |
| ------------ | ------------------------------------------------------------------------ | -------------------------------- |
| `answered`   | Visible with a valid value. It is in `current`.                          | No                               |
| `unanswered` | Unknown, but known not to be required.                                   | No                               |
| `missing`    | Visible, required and unknown.                                           | Yes                              |
| `invalid`    | Value fails its constraints.                                             | Only if not known to be optional |
| `pending`    | Applicability is unknown. The question has a value or could be required. | Yes                              |
| `inactive`   | Hidden. Any value goes to `inactive`, not `current`.                     | No                               |

An observation is complete when no question blocks. Follow-ups include:

- missing or invalid required questions, which are asked directly;
- prerequisites: for a pending question, the system follows unknown conditions up the dependency graph until it reaches visible questions with unknown answers. It asks those. It never asks a question whose applicability is unknown or a hidden question.

This prevents deadlock. Validated contracts are acyclic, and questions without visibility rules are always visible. So every incomplete evaluation names at least one question that can be asked. A test checks this over all answer combinations of the match example. If a scout cannot answer a prerequisite, the session stays incomplete, as it does for any missing required answer today. Answering the dependent question directly also resolves the dependency. For example, defence notes satisfy the requirement even if "played defence" is unknown.

## Validation

`validateContract(document, kind)` returns `{ ok: true, contract }` or `{ ok: false, issues }`. Each issue has a `code`, a `path` to the question, option or rule, the affected question `key` and a message.

| Code                                                                           | Cause                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `invalid_structure`                                                            | Schema error, bad code, empty group or expression string                |
| `unsupported_format`                                                           | `formatVersion` is not supported                                        |
| `unsupported_type`                                                             | Unknown answer type                                                     |
| `kind_mismatch`                                                                | Document kind is not the expected kind                                  |
| `duplicate_question`                                                           | Code used more than once                                                |
| `duplicate_option`                                                             | Repeated option code or label (case-insensitive)                        |
| `invalid_constraint`                                                           | Integer bound with decimals, `min` > `max`, impossible selection limits |
| `invalid_rule`                                                                 | Condition nested too deeply                                             |
| `unsupported_comparison`                                                       | Operator not valid for the upstream type, or a value of the wrong type  |
| `missing_reference`                                                            | Rule refers to a question that does not exist                           |
| `missing_option`                                                               | Rule refers to an option that does not exist                            |
| `self_reference`                                                               | Rule refers to its own question                                         |
| `cycle`                                                                        | Rules depend on each other in a loop                                    |
| `conflicting_rules`                                                            | Show and hide rules on the same question                                |
| `redundant_rule`                                                               | `require` on a required question, or `optional` on an optional question |
| `identity_missing`, `identity_excluded`, `identity_type`, `identity_protected` | Identity contract violation                                             |

### Changed or deleted upstream questions

Publications never change, so a change always makes a new draft and version. Validation of that draft reports each dependent rule:

- Deleted upstream question: `missing_reference` on each rule that uses it.
- Deleted option: `missing_option` on each rule that uses it.
- Changed upstream type: `unsupported_comparison` when the operator or value no longer fits.

The author must fix or remove those rules before publication. Existing sessions and observations keep their original publication.

## Identity by kind

Event context always comes from the session's event binding. Contracts cannot change it.

| Kind      | `match`     | `team_number` |
| --------- | ----------- | ------------- |
| `match`   | Required    | Required      |
| `pit`     | Not allowed | Required      |
| `general` | Optional    | Optional      |

Identity questions keep their system type: `match` is text, and `team_number` is an integer with `min` 1 or more. Identity questions cannot have `show` or `hide` rules. Required identity cannot be optional and cannot have `optional` rules. Optional identity can have `require` rules. For example, a general note requires a team when its topic is a team.

## History and reactivation

`foldTurns(contract, turns)` processes ordered turns: the initial note, then each linked reply or correction. Each turn has only the values stated in that turn. `null` retracts an earlier answer. Rules are evaluated again after every turn.

- The latest statement of a question is `active`. Earlier statements are `superseded`.
- When a question is hidden, all its statements up to that turn become `inactive`. They stay in history and in `inactive`, and are excluded from `current`, completeness and export.
- When a hidden question is shown again, it starts unknown. Only a value stated in the reactivating turn or later can become current. The question is asked again. Restating the same value is accepted. Thus a stale value never becomes current again without a new statement.
- A question with unknown applicability is not hidden, so its answer is not stale.

The extraction pipeline supplies the values stated in each turn, not only a cumulative snapshot. With snapshots only, a restated value looks the same as a stale one.

## Extraction

`extraction.ts` connects the contract to the model (#48).

- `modelContract(contract)` is the model's view: code, label, follow-up wording, guidance and an answer description with option codes and bounds. Rules are not sent. The model does not decide applicability or completeness.
- `modelOutputSchema(contract, messages)` is the structured output: one entry per message, each with optional values. Absent means "not stated", `null` means "withdrawn or not known". Value types are loose (a number, a string, a boolean or a list of strings), so `checkAnswer` reports an out-of-range number or an unlisted option as invalid instead of the schema forcing a valid answer.
- `extractionInstructions` tells the model that the contract is trusted and scout messages are data, never instructions.
- `finalizeTurns(contract, turns)` drops keys outside the contract, runs `foldTurns` and returns the stored result: current `values`, per-question `fields` (state, visibility, requirement, problem), `inactive`, `missing`, `followUps`, the follow-up `question`, the statements and history.
- `followUpQuestion` asks identity questions first and alone, then the other follow-ups in contract order. An invalid answer is asked again with its reason, for example "I could not use your answer for Climb level (Not one of the options)."

## Worked examples

The examples are in `packages/scouting/src/examples/`. `rules.test.ts` checks each case.

**Climb to climb level.** `climb_level` has `show when climbed = true`. If `climbed` is `true` and the level is unknown, the system asks "Which level did the robot climb to?". If `climbed` is `false`, the level is hidden, is not required, and the observation can complete.

**Conditional optionality.** `defence_notes` is optional with `require when played_defence = true`. `cycle_speed` is required with `optional when robot_status = disabled`. If `played_defence` is unknown, the requirement of `defence_notes` is unknown. The system asks "Did the robot play defence?" as a prerequisite and also asks for the notes.

**Chained unknown conditions.** `climbed` is shown when `robot_status` is `played` or `disabled`, and `climb_level` depends on `climbed`. If the note gives only a climb level, both questions are pending. The level is not current, and the system asks for the robot status first. A `no_show` hides the whole chain.

**Numeric zero.** `auto_pieces` has `min: 0`, so `0` is an answer and completes the question. `team_number` has `min: 1`, so `0` is invalid. `null` is unknown in both cases.

**Explicit boolean false.** `climbed: false` and `played_defence: false` are answers in `current`. They are not missing.

**Reactivation.** The turns are: climbed with level `mid`, then "did not climb", then "it did climb". After these turns, `climb_level` is unknown and asked again, and `mid` stays in inactive history until the scout states a level again.
