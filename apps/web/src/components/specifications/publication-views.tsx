"use client";

import type { Contract, ObservationKind } from "@ai-scouting/scouting";
import { useState } from "react";
import {
  type DraftTestMessage,
  testSpecificationPublication,
} from "@/app/admin/specification-actions";
import { toEditorQuestions } from "@/lib/specification-model";
import { AnswerPreview } from "./answer-preview";
import { ExtractionTest, type TestRun } from "./extraction-test";
import { PublishedQuestions } from "./question-details";
import { ViewTabs } from "./view-tabs";

type View = "questions" | "preview" | "test";

// A published version's questions, with the same answer preview and extraction test as a draft.
// The contract was validated at publication, so both always run.
export function PublicationViews({
  organizationId,
  season,
  kind,
  version,
  contract,
}: {
  organizationId: string;
  season: number;
  kind: ObservationKind;
  version: string;
  contract: Contract;
}) {
  const [view, setView] = useState<View>("questions");
  const [questions] = useState(() => toEditorQuestions(contract.questions));
  const run = async (messages: DraftTestMessage[]): Promise<TestRun> => {
    const response = await testSpecificationPublication(
      organizationId,
      { season, kind, version },
      messages,
    );
    return response.outcome === "tested"
      ? { outcome: "tested", result: response.result, label: version }
      : response;
  };
  return (
    <div className="space-y-6">
      <ViewTabs
        label="Published version views"
        view={view}
        onChange={setView}
        tabs={[
          { id: "questions", name: "Questions", count: contract.questions.length },
          { id: "preview", name: "Preview answers" },
          { id: "test", name: "Test extraction" },
        ]}
      />
      <div
        role="tabpanel"
        id="panel-questions"
        aria-labelledby="tab-questions"
        hidden={view !== "questions"}
      >
        <PublishedQuestions kind={kind} questions={contract.questions} />
      </div>
      <div
        role="tabpanel"
        id="panel-preview"
        aria-labelledby="tab-preview"
        hidden={view !== "preview"}
      >
        <AnswerPreview kind={kind} contract={contract} questions={questions} />
      </div>
      <div role="tabpanel" id="panel-test" aria-labelledby="tab-test" hidden={view !== "test"}>
        <ExtractionTest
          kind={kind}
          contract={contract}
          target={`published version ${version}`}
          run={run}
        />
      </div>
    </div>
  );
}
