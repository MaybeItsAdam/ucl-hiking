import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findAlumniSignIn, isGrantedAlumnus } from "./alumniStore";

type Row = Record<string, unknown>;

/** Just enough of supabase-js for the alumni lookups: select/eq/maybeSingle, insert, update. */
function fakeDb(tables: { members: Row[]; alumni: Row[] }) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const client = {
    from(table: "members" | "alumni") {
      const rows = tables[table];
      return {
        select: () => {
          const filters: [string, unknown][] = [];
          const q = {
            eq(col: string, value: unknown) {
              filters.push([col, value]);
              return q;
            },
            async maybeSingle() {
              const found = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
              return { data: found[0] ?? null, error: null };
            },
          };
          return q;
        },
        async insert(row: Row) {
          inserts.push({ table, ...row });
          rows.push(row);
          return { error: null };
        },
        update(row: Row) {
          return {
            async eq(col: string, value: unknown) {
              updates.push({ table, ...row, [col]: value });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { supabase: client as unknown as SupabaseClient, inserts, updates };
}

const lapsed = { id: "m1", email: "zcabada@ucl.ac.uk", toolbox_user_id: "tb-old", revoked_at: "2026-09-01T00:00:00Z", membership_expires_at: null };
const current = { ...lapsed, id: "m2", email: "zcabbob@ucl.ac.uk", toolbox_user_id: "tb-bob", revoked_at: null };

const find = (supabase: SupabaseClient, email: string, login = "tb-new") => findAlumniSignIn(supabase, email, login, "*");

describe("findAlumniSignIn", () => {
  it("ignores addresses that aren't @alumni.ucl.ac.uk", async () => {
    const { supabase } = fakeDb({ members: [lapsed], alumni: [] });
    expect(await find(supabase, "zcabada@ucl.ac.uk")).toBeNull();
  });

  it("links a former member by the same name before the @ and grants alumni access", async () => {
    const { supabase, inserts } = fakeDb({ members: [lapsed], alumni: [] });
    expect(await find(supabase, "ZCABADA@alumni.ucl.ac.uk")).toMatchObject({ id: "m1" });
    expect(inserts).toEqual([{ table: "alumni", member_id: "m1", alumni_email: "zcabada@alumni.ucl.ac.uk", source: "auto", granted_by: null }]);
  });

  it("links by the same UCL login when the names differ", async () => {
    const { supabase } = fakeDb({ members: [lapsed], alumni: [] });
    expect(await find(supabase, "ada.lovelace.18@alumni.ucl.ac.uk", "tb-old")).toMatchObject({ id: "m1" });
  });

  it("follows an address a principal typed in, and needs no other match", async () => {
    const { supabase, inserts } = fakeDb({
      members: [lapsed],
      alumni: [{ member_id: "m1", alumni_email: "ada.lovelace.18@alumni.ucl.ac.uk", revoked_at: null }],
    });
    expect(await find(supabase, "ada.lovelace.18@alumni.ucl.ac.uk")).toMatchObject({ id: "m1" });
    expect(inserts).toEqual([]);
  });

  it("remembers the address on a principal's grant that didn't have one", async () => {
    const { supabase, updates } = fakeDb({ members: [lapsed], alumni: [{ member_id: "m1", alumni_email: null, revoked_at: null }] });
    expect(await find(supabase, "zcabada@alumni.ucl.ac.uk")).toMatchObject({ id: "m1" });
    expect(updates).toEqual([{ table: "alumni", alumni_email: "zcabada@alumni.ucl.ac.uk", member_id: "m1" }]);
  });

  it("keeps out someone a principal took access from, however they're found", async () => {
    const taken = { member_id: "m1", alumni_email: "zcabada@alumni.ucl.ac.uk", revoked_at: "2026-10-01T00:00:00Z" };
    const byAddress = fakeDb({ members: [lapsed], alumni: [taken] });
    expect(await find(byAddress.supabase, "zcabada@alumni.ucl.ac.uk")).toBeNull();
    const byLogin = fakeDb({ members: [lapsed], alumni: [{ ...taken, alumni_email: null }] });
    expect(await find(byLogin.supabase, "someone@alumni.ucl.ac.uk", "tb-old")).toBeNull();
    expect(byLogin.inserts).toEqual([]);
  });

  it("turns away alumni addresses that match nobody", async () => {
    const { supabase, inserts } = fakeDb({ members: [lapsed], alumni: [] });
    expect(await find(supabase, "stranger@alumni.ucl.ac.uk")).toBeNull();
    expect(inserts).toEqual([]);
  });

  it("signs a current member in as themselves without granting anything", async () => {
    const { supabase, inserts } = fakeDb({ members: [current], alumni: [] });
    expect(await find(supabase, "zcabbob@alumni.ucl.ac.uk")).toMatchObject({ id: "m2" });
    expect(inserts).toEqual([]);
  });

  it("treats a taken-back grant as no grant", async () => {
    const { supabase } = fakeDb({ members: [lapsed], alumni: [{ member_id: "m1", revoked_at: "2026-10-01T00:00:00Z" }] });
    expect(await isGrantedAlumnus(supabase, "m1")).toBe(false);
  });
});
