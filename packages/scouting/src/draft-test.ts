import { z } from "zod";
import type { ObservationKind } from "./contract.ts";
import type { ExtractionMessage } from "./extraction.ts";

// Draft testing (#49). Admins try a draft with synthetic notes before publishing it.
// Tests never create sessions, send Telegram messages or change publications.

// Tighter than production: a test is a short synthetic exchange, not a whole session.
export const LIMITS_DRAFT_TEST = { messages: 6, text: 2000, asked: 500, total: 6000 } as const;

export const draftTestMessagesSchema = z
  .array(
    z
      .object({
        role: z.enum(["note", "reply"]),
        asked: z.string().trim().max(LIMITS_DRAFT_TEST.asked).optional(),
        text: z.string().trim().min(1).max(LIMITS_DRAFT_TEST.text),
      })
      .strict(),
  )
  .min(1)
  .max(LIMITS_DRAFT_TEST.messages)
  .refine((messages) => messages[0]?.role === "note", "Start with the scout's note")
  .refine(
    (messages) => messages.slice(1).every((m) => m.role === "reply"),
    "Only the first message is a note; the rest are replies",
  )
  .refine(
    (messages) =>
      messages.reduce((sum, m) => sum + m.text.length + (m.asked?.length ?? 0), 0) <=
      LIMITS_DRAFT_TEST.total,
    `Keep the whole sample under ${LIMITS_DRAFT_TEST.total} characters`,
  );

// A synthetic exchange with the values a correct extraction states in each message.
// Values are keyed to the worked example contract of the same kind (examples/<kind>.json).
export interface SampleCase {
  id: string;
  kind: ObservationKind;
  title: string;
  // What the case exercises, for the admin choosing it.
  shows: string;
  messages: ExtractionMessage[];
  turns: Record<string, unknown>[];
}

// Invented teams' behaviour and invented notes only. Never copy real scout messages here.
export const sampleCases: SampleCase[] = [
  {
    id: "match-complete",
    kind: "match",
    title: "Complete note",
    shows: "Every required answer in one note, with explicit “no defence”.",
    messages: [
      {
        role: "note",
        text: "Q14 team 1241 played the whole match. 3 pieces in auto, climbed to high. Fast cycles, no defence.",
      },
    ],
    turns: [
      {
        match: "Q14",
        team_number: 1241,
        robot_status: "played",
        auto_pieces: 3,
        climbed: true,
        climb_level: "high",
        cycle_speed: "fast",
        played_defence: false,
      },
    ],
  },
  {
    id: "match-climb-level",
    kind: "match",
    title: "Conditional climb level",
    shows: "Climbing makes climb level required; a short reply answers the follow-up.",
    messages: [
      {
        role: "note",
        text: "Q22, 1114 played. 2 in auto and they climbed. Average cycles, didn't defend.",
      },
      { role: "reply", asked: "Which level did the robot climb to?", text: "mid" },
    ],
    turns: [
      {
        match: "Q22",
        team_number: 1114,
        robot_status: "played",
        auto_pieces: 2,
        climbed: true,
        cycle_speed: "average",
        played_defence: false,
      },
      { climb_level: "mid" },
    ],
  },
  {
    id: "match-correction",
    kind: "match",
    title: "Upstream correction",
    shows:
      "A correction changes robot status and the climb, so climb level becomes inactive. Zero auto and “did not climb” are answers.",
    messages: [
      {
        role: "note",
        text: "Q31 team 2056 got disabled halfway. 1 in auto, climbed low. No defence.",
      },
      {
        role: "reply",
        text: "Correction: 2056 actually played the whole match. 0 in auto and they did not climb. Slow cycles.",
      },
    ],
    turns: [
      {
        match: "Q31",
        team_number: 2056,
        robot_status: "disabled",
        auto_pieces: 1,
        climbed: true,
        climb_level: "low",
        played_defence: false,
      },
      { robot_status: "played", auto_pieces: 0, climbed: false, cycle_speed: "slow" },
    ],
  },
  {
    id: "match-incomplete",
    kind: "match",
    title: "Incomplete note",
    shows: "No match or team, so identity is asked first and alone.",
    messages: [{ role: "note", text: "Robot looked fast, scored 4 in auto." }],
    turns: [{ auto_pieces: 4 }],
  },
  {
    id: "pit-climb-levels",
    kind: "pit",
    title: "Pit visit with climb levels",
    shows: "Can climb shows climb levels; a decimal weight.",
    messages: [
      {
        role: "note",
        text: "Pit 1241: swerve drive. They can climb to low and high. Robot weighs 52.5 kg.",
      },
    ],
    turns: [
      {
        team_number: 1241,
        drivetrain: "swerve",
        can_climb: true,
        climb_levels: ["low", "high"],
        weight_kg: 52.5,
      },
    ],
  },
  {
    id: "pit-explicit-false",
    kind: "pit",
    title: "Explicit “cannot climb”",
    shows: "An explicit no hides climb levels and completes the note.",
    messages: [{ role: "note", text: "4917 pit. Tank drive, they can't climb this year." }],
    turns: [{ team_number: 4917, drivetrain: "tank", can_climb: false }],
  },
  {
    id: "pit-incomplete",
    kind: "pit",
    title: "Incomplete pit note",
    shows: "Climbing is not mentioned, so the scout is asked.",
    messages: [{ role: "note", text: "Visited 2056. Swerve." }],
    turns: [{ team_number: 2056, drivetrain: "swerve" }],
  },
  {
    id: "general-field",
    kind: "general",
    title: "Field note",
    shows: "No team is needed when the note is about the field.",
    messages: [
      { role: "note", text: "Field: the carpet near the blue loading zone is torn and taped." },
    ],
    turns: [{ topic: "field", notes: "The carpet near the blue loading zone is torn and taped." }],
  },
  {
    id: "general-team",
    kind: "general",
    title: "Team note needs a team",
    shows: "A note about a team makes the team number required.",
    messages: [
      { role: "note", text: "One team's bumper fell off in the queue." },
      { role: "reply", asked: "Which team was this about?", text: "1310" },
    ],
    turns: [{ topic: "team", notes: "Bumper fell off in the queue." }, { team_number: 1310 }],
  },
];

export const sampleCasesFor = (kind: ObservationKind) =>
  sampleCases.filter((sample) => sample.kind === kind);
