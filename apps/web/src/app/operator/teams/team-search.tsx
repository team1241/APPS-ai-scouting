"use client";

import { Button, Label, SearchField } from "@heroui/react";
import { Search } from "lucide-react";

// A plain GET form, so the search lives in the URL and works before hydration.
export function TeamSearch({ search }: { search: string }) {
  return (
    <search>
      <form action="/operator/teams" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <SearchField
          name="q"
          defaultValue={search}
          maxLength={120}
          autoComplete="off"
          fullWidth
          className="min-w-0 flex-1"
        >
          <Label>Team number or name</Label>
          <SearchField.Group className="min-h-11">
            <SearchField.SearchIcon />
            <SearchField.Input />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button type="submit" variant="outline" className="px-5">
          <Search aria-hidden="true" className="size-4" />
          Search
        </Button>
      </form>
    </search>
  );
}
