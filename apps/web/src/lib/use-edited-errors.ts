"use client";

import { useCallback, useEffect, useState } from "react";

// Server-action errors describe the last submit. Hide a field's error as soon as the
// person edits that field; every error comes back only if the next submit finds it again.
export function useEditedErrors<Field extends string>(state: unknown) {
  const [edited, setEdited] = useState<ReadonlySet<Field>>(new Set());
  // A new submit result replaces the edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state is the reset signal.
  useEffect(() => setEdited(new Set()), [state]);
  const edit = useCallback(
    (field: Field) =>
      setEdited((previous) => (previous.has(field) ? previous : new Set(previous).add(field))),
    [],
  );
  const shown = useCallback(
    <T>(field: Field, error: T | undefined) => (edited.has(field) ? undefined : error),
    [edited],
  );
  return { edit, shown };
}
