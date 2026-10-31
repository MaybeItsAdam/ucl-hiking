"use client";

import Form from "next/form";
import { Search } from "lucide-react";
// Types only: lib/routeCatalogue reaches server modules, so the sorts come in as a prop.
import type { CatalogueQuery, CatalogueSort } from "@/lib/routeCatalogue";

/**
 * The catalogue's search box and sort. A plain GET form (next/form navigates
 * in place), so the list stays server-rendered and the URL is the state:
 * Back returns to the same search, and it works before the JS has loaded.
 * Changing the sort submits at once; the search on Enter or the button.
 */
export function RouteCatalogueSearch({
  query,
  sorts,
}: {
  query: CatalogueQuery;
  sorts: readonly { key: CatalogueSort; label: string }[];
}) {
  return (
    <Form action="/portal/events/routes" className="routes-toolbar" role="search">
      <label className="roster-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search routes by name</span>
        <input type="search" name="q" defaultValue={query.q} placeholder="Search by name" enterKeyHint="search" autoComplete="off" />
      </label>
      {query.band ? <input type="hidden" name="band" value={query.band} /> : null}
      {query.all ? <input type="hidden" name="show" value="all" /> : null}
      <label className="routes-sort">
        <span className="sr-only">Sort</span>
        <select name="sort" defaultValue={query.sort} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="kit-btn routes-go">
        Search
      </button>
    </Form>
  );
}
