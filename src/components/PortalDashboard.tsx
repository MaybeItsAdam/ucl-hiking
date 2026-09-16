"use client";

import { useState } from "react";
import {
  Shield,
  Crown,
  Package,
  Compass,
  ArrowRight,
  Users,
} from "lucide-react";
import type { Member } from "@/lib/types";
import { EquipmentPortal } from "./EquipmentPortal";
import { MemberAdminPortal } from "./MemberAdminPortal";

export type PortalSection = "inventory" | "members";

interface PortalDashboardProps {
  member: Member;
  isCommittee: boolean;
  isPrincipal: boolean;
  isWalkLeader: boolean;
  initialView?: "officer" | "member";
  initialSection?: PortalSection;
}

export function PortalDashboard({
  member,
  isCommittee,
  isPrincipal,
  initialView,
  initialSection = "inventory",
}: PortalDashboardProps) {
  const isGovernance = isCommittee || isPrincipal;

  const [viewMode, setViewMode] = useState<"officer" | "member">(() => {
    if (initialView) return initialView;
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const q = urlParams.get("view");
      if (q === "officer" || q === "member") return q;
      const saved = localStorage.getItem("ucl_portal_view");
      if (saved === "officer" || saved === "member") return saved;
    }
    return isGovernance ? "officer" : "member";
  });

  const handleSwitchView = (mode: "officer" | "member") => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("ucl_portal_view", mode);
      const url = new URL(window.location.href);
      url.searchParams.set("view", mode);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const [section, setSection] = useState<PortalSection>(initialSection);

  const handleSwitchSection = (next: PortalSection) => {
    setSection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "inventory") url.searchParams.delete("section");
      else url.searchParams.set("section", next);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const isOfficerView = isGovernance && viewMode === "officer";
  const activeSection: PortalSection = isOfficerView ? section : "inventory";

  return (
    <div style={{ padding: "0 4px 40px" }}>
      {/* 1. TOP CONTEXT HEADER */}
      <div
        className="portal-context-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          padding: "24px 0 20px",
          borderBottom: "1px solid var(--line)",
          marginBottom: "24px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="portal-context-meta" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "11px",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: isGovernance ? "#ecfdf5" : "#eff6ff",
                color: isGovernance ? "#065f46" : "#1e40af",
                padding: "3px 9px",
                borderRadius: "999px",
                border: `1px solid ${isGovernance ? "#a7f3d0" : "#bfdbfe"}`,
              }}
            >
              {isPrincipal ? <Crown size={12} /> : <Shield size={12} />}
              <span>{isPrincipal ? "Principal Officer" : isCommittee ? "Committee Executive" : "Club Member"}</span>
            </span>
            <span style={{ fontSize: "12px", opacity: 0.65 }}>
              UCL Hiking Club
            </span>
          </div>

          <h1 className="portal-context-title" style={{ margin: "0 0 6px", fontSize: "clamp(26px, 3.5vw, 36px)", fontFamily: "var(--font-display)" }}>
            {activeSection === "members"
              ? "Membership List"
              : isOfficerView
                ? "Committee Inventory System"
                : "Equipment Locker"}
          </h1>
          <p className="portal-context-sub" style={{ margin: 0, opacity: 0.7, fontSize: "14px" }}>
            {activeSection === "members"
              ? "Active members synced from the Students' Union roster."
              : isOfficerView
              ? `Welcome, ${member.full_name?.split(" ")[0] || "Officer"}. Track gear stock levels, manage loans, and approve student equipment requests.`
              : `Welcome, ${member.full_name?.split(" ")[0] || "hiker"}. Browse club equipment and submit gear loan requests for upcoming hikes.`}
          </p>
        </div>

        {isGovernance && activeSection === "inventory" && (
          <div className="portal-view-switch" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {viewMode === "officer" ? (
              <button
                type="button"
                onClick={() => handleSwitchView("member")}
                className="button compact"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  background: "white",
                  border: "1px solid var(--line)",
                }}
                title="Preview what regular club hikers see when requesting kit"
              >
                <Compass size={14} />
                <span>Preview Member Perspective</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSwitchView("officer")}
                className="button primary compact"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                }}
              >
                <Shield size={14} />
                <span>Return to Committee Mode</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2. PERSPECTIVE BANNER IF IN MEMBER MODE AS COMMITTEE */}
      {isGovernance && viewMode === "member" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 18px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "12px",
            marginBottom: "20px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#1e40af" }}>
            <Package size={16} />
            <span>
              Viewing as <strong>Standard Member</strong> (Gear Locker Request Mode)
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleSwitchView("officer")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "12px",
              fontWeight: 700,
              background: "none",
              border: "none",
              color: "#1d4ed8",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span>Return to Committee Inventory Management</span>
            <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* 3. COMMITTEE SECTION TABS */}
      {isOfficerView && (
        <div className="portal-section-tabs" role="tablist" aria-label="Committee sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "inventory"}
            className={activeSection === "inventory" ? "active" : ""}
            onClick={() => handleSwitchSection("inventory")}
          >
            <Package size={15} aria-hidden="true" />
            Inventory
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "members"}
            className={activeSection === "members" ? "active" : ""}
            onClick={() => handleSwitchSection("members")}
          >
            <Users size={15} aria-hidden="true" />
            Members
          </button>
        </div>
      )}

      {/* 4. SECTION CONTENT */}
      {activeSection === "members" ? (
        <MemberAdminPortal />
      ) : (
        <EquipmentPortal
          memberId={member.id}
          membershipTier={member.membership_tier}
          isCommittee={isOfficerView}
        />
      )}
    </div>
  );
}
