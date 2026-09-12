"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  UserRound,
  ChevronDown,
  ArrowRight,
  RotateCcw,
  Check,
  LogOut,
  SlidersHorizontal,
  Sparkles,
  Compass,
  Mountain,
  Users,
  Shield,
  Crown,
  Globe,
} from "lucide-react";
import { accessSummary, type GovernanceRole, type MembershipTier } from "@/lib/access";
import type { Member } from "@/lib/types";
import type { RolePreviewConfig } from "@/lib/session";
import { SignInButton } from "@/components/SignInButton";

interface AccountButtonProps {
  member: Member | null;
  isRealAdmin: boolean;
  preview: RolePreviewConfig | null;
  realMember?: Member | null;
}

interface Preset {
  id: string;
  label: string;
  badge: string;
  description: string;
  tier: MembershipTier;
  governance: GovernanceRole | null;
  walkLeader: boolean;
  simulateSignedOut?: boolean;
  icon: typeof Sparkles;
  iconColor: string;
  iconBg: string;
}

const PRESETS: Preset[] = [
  {
    id: "guest",
    label: "Public Visitor",
    badge: "Guest",
    description: "Simulate an unauthenticated guest visitor",
    tier: "standard",
    governance: null,
    walkLeader: false,
    simulateSignedOut: true,
    icon: Globe,
    iconColor: "#2563eb",
    iconBg: "#eff6ff",
  },
  {
    id: "taster",
    label: "Taster Member",
    badge: "Free",
    description: "Trial member restricted from standard walk booking",
    tier: "taster",
    governance: null,
    walkLeader: false,
    icon: Sparkles,
    iconColor: "#d97706",
    iconBg: "#fef3c7",
  },
  {
    id: "standard",
    label: "Standard Member",
    badge: "General",
    description: "Standard walk booking access and club socials",
    tier: "standard",
    governance: null,
    walkLeader: false,
    icon: Compass,
    iconColor: "#059669",
    iconBg: "#ecfdf5",
  },
  {
    id: "explorer",
    label: "Explorer Member",
    badge: "Tier 2",
    description: "Priority booking on mountain weekends & all hikes",
    tier: "explorer",
    governance: null,
    walkLeader: false,
    icon: Mountain,
    iconColor: "#7c3aed",
    iconBg: "#f5f3ff",
  },
  {
    id: "leader",
    label: "Walk Leader",
    badge: "Leader",
    description: "Standard member with walk management & roster tools",
    tier: "standard",
    governance: null,
    walkLeader: true,
    icon: Users,
    iconColor: "#0284c7",
    iconBg: "#f0f9ff",
  },
  {
    id: "committee",
    label: "Committee Member",
    badge: "Governance",
    description: "Full sync monitor, member admin & roster tools",
    tier: "standard",
    governance: "committee",
    walkLeader: true,
    icon: Shield,
    iconColor: "#08a8ad",
    iconBg: "#e6fffa",
  },
  {
    id: "principal",
    label: "Principal Officer",
    badge: "Officer",
    description: "President / Treasurer with SU session management",
    tier: "explorer",
    governance: "principal",
    walkLeader: true,
    icon: Crown,
    iconColor: "#b45309",
    iconBg: "#fef3c7",
  },
];

export function AccountButton({
  member,
  isRealAdmin,
  preview,
  realMember,
}: AccountButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"presets" | "custom">("presets");
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Custom configuration state
  const [customTier, setCustomTier] = useState<MembershipTier>(
    preview?.membershipTier || "standard"
  );
  const [customGovernance, setCustomGovernance] = useState<GovernanceRole | null>(
    preview ? preview.governanceRole : null
  );
  const [customWalkLeader, setCustomWalkLeader] = useState<boolean>(
    preview?.isWalkLeader || false
  );
  const [customSignedOut, setCustomSignedOut] = useState<boolean>(
    preview?.simulateSignedOut || false
  );

  const isPreviewActive = Boolean(preview?.active);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const handleReset = async () => {
    setLoading(true);
    try {
      await fetch("/api/admin/role-preview", { method: "DELETE" });
      setIsOpen(false);
      window.location.reload();
    } catch {
      setLoading(false);
    }
  };

  const applyPreset = async (p: Preset) => {
    setLoading(true);
    try {
      await fetch("/api/admin/role-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipTier: p.tier,
          governanceRole: p.simulateSignedOut ? null : p.governance,
          isWalkLeader: p.simulateSignedOut ? false : p.walkLeader,
          simulateSignedOut: Boolean(p.simulateSignedOut),
        }),
      });
      setIsOpen(false);
      window.location.reload();
    } catch {
      setLoading(false);
    }
  };

  const handleCustomApply = async () => {
    setLoading(true);
    try {
      await fetch("/api/admin/role-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipTier: customTier,
          governanceRole: customSignedOut ? null : customGovernance,
          isWalkLeader: customSignedOut ? false : customWalkLeader,
          simulateSignedOut: customSignedOut,
        }),
      });
      setIsOpen(false);
      window.location.reload();
    } catch {
      setLoading(false);
    }
  };

  // If user is neither signed in nor a real admin, show simple sign in button
  if (!member && !isRealAdmin) {
    return <SignInButton compact />;
  }

  // If non-admin user is signed in, standard simple link pill
  if (member && !isRealAdmin) {
    return (
      <Link className="member-pill" href="/portal">
        <span className="avatar">
          <UserRound size={15} />
        </span>
        <span className="member-pill-copy">
          <strong>{member.full_name?.split(" ")[0] || "My account"}</strong>
          <small>
            {accessSummary({
              membershipTier: member.membership_tier,
              governanceRole: member.governance_role,
              isWalkLeader: member.is_walk_leader,
            })}
          </small>
        </span>
      </Link>
    );
  }

  // User is a real admin
  const displayName =
    realMember?.full_name?.split(" ")[0] || member?.full_name?.split(" ")[0] || "Admin";
  const userEmail = realMember?.email || member?.email || "";

  const previewDescription = preview?.simulateSignedOut
    ? "Guest (Signed Out)"
    : preview
    ? accessSummary({
        membershipTier: preview.membershipTier,
        governanceRole: preview.governanceRole,
        isWalkLeader: preview.isWalkLeader,
      })
    : "Full Admin";

  return (
    <div className="account-menu-container" ref={containerRef}>
      {member ? (
        <button
          type="button"
          className={`member-pill member-pill-btn ${isPreviewActive ? "is-previewing" : ""}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label="Account and preview menu"
        >
          <span className="avatar">
            <UserRound size={15} />
          </span>
          <span className="member-pill-copy">
            <span className="member-pill-top">
              <strong>{displayName}</strong>
              {isPreviewActive ? (
                <span className="preview-badge-chip">PREVIEW</span>
              ) : (
                <span className="admin-badge-chip">ADMIN</span>
              )}
            </span>
            <small>
              {isPreviewActive ? previewDescription : "Full Admin Access"}
            </small>
          </span>
          <ChevronDown
            size={14}
            className={`pill-chevron ${isOpen ? "open" : ""}`}
          />
        </button>
      ) : (
        <div className="guest-preview-group">
          <SignInButton compact />
          <button
            type="button"
            className="guest-preview-pill"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
          >
            <span className="pulse-dot" />
            <span>Preview: Guest</span>
            <ChevronDown
              size={13}
              className={`pill-chevron ${isOpen ? "open" : ""}`}
            />
          </button>
        </div>
      )}

      {isOpen && (
        <div className="account-popover" role="menu">
          {/* User profile banner */}
          <div className="popover-profile">
            <div className="popover-avatar">
              <UserRound size={17} />
            </div>
            <div className="popover-user-details">
              <div className="popover-name-row">
                <strong>{realMember?.full_name || member?.full_name || "Admin"}</strong>
                <span className="popover-role-badge">Real Admin</span>
              </div>
              <span className="popover-email">{userEmail}</span>
            </div>
          </div>

          {/* Direct Inventory Portal link */}
          <Link
            href="/portal"
            className="popover-portal-link"
            onClick={() => setIsOpen(false)}
          >
            <span>Equipment &amp; Inventory</span>
            <ArrowRight size={14} />
          </Link>

          {/* Active Preview Callout Card */}
          {isPreviewActive && (
            <div className="preview-callout-card">
              <div className="preview-callout-text">
                <span className="callout-kicker">Role Preview Active</span>
                <strong>{previewDescription}</strong>
              </div>
              <button
                type="button"
                className="callout-exit-btn"
                onClick={handleReset}
                disabled={loading}
              >
                <RotateCcw size={11} />
                <span>Exit</span>
              </button>
            </div>
          )}

          <div className="popover-divider" />

          {/* Role Preview Section */}
          <div className="popover-preview-section">
            <div className="popover-preview-header">
              <div className="preview-header-left">
                <SlidersHorizontal size={13} />
                <span>SELECT PREVIEW ROLE</span>
              </div>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="popover-mode-tabs">
              <button
                type="button"
                className={`tab-btn ${mode === "presets" ? "active" : ""}`}
                onClick={() => setMode("presets")}
              >
                Quick Roles
              </button>
              <button
                type="button"
                className={`tab-btn ${mode === "custom" ? "active" : ""}`}
                onClick={() => setMode("custom")}
              >
                Custom Matrix
              </button>
            </div>

            {mode === "presets" ? (
              <div className="popover-presets-grid">
                {PRESETS.map((p) => {
                  const Icon = p.icon;
                  const isCurrent = p.simulateSignedOut
                    ? preview?.simulateSignedOut
                    : !preview?.simulateSignedOut &&
                      preview?.membershipTier === p.tier &&
                      preview?.governanceRole === p.governance &&
                      preview?.isWalkLeader === p.walkLeader;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`popover-preset-card ${isCurrent ? "active" : ""}`}
                      onClick={() => applyPreset(p)}
                      disabled={loading}
                    >
                      <div
                        className="preset-icon-box"
                        style={{ background: p.iconBg, color: p.iconColor }}
                      >
                        <Icon size={16} />
                      </div>
                      <div className="preset-card-body">
                        <div className="preset-card-title-row">
                          <strong>{p.label}</strong>
                          <span className="preset-pill-tag">{p.badge}</span>
                        </div>
                        <p>{p.description}</p>
                      </div>
                      <div className={`preset-radio-indicator ${isCurrent ? "checked" : ""}`}>
                        {isCurrent && <Check size={11} strokeWidth={3} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="popover-custom-matrix">
                {/* Switch: Simulate Signed Out */}
                <div
                  className="modern-switch-row"
                  onClick={() => setCustomSignedOut(!customSignedOut)}
                >
                  <div className="switch-info">
                    <strong>Simulate Signed-Out</strong>
                    <small>View site as an unauthenticated guest</small>
                  </div>
                  <div className={`modern-switch ${customSignedOut ? "on" : "off"}`}>
                    <div className="switch-knob" />
                  </div>
                </div>

                {!customSignedOut && (
                  <>
                    <div className="custom-control-group">
                      <span className="control-label">Membership Tier</span>
                      <div className="segmented-control">
                        {(["taster", "standard", "explorer"] as MembershipTier[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`seg-item ${customTier === t ? "active" : ""}`}
                            onClick={() => setCustomTier(t)}
                          >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="custom-control-group">
                      <span className="control-label">Governance Role</span>
                      <div className="segmented-control">
                        {[
                          { role: null, label: "None" },
                          { role: "committee", label: "Committee" },
                          { role: "principal", label: "Officer" },
                          { role: "admin", label: "Admin" },
                        ].map(({ role, label }) => (
                          <button
                            key={label}
                            type="button"
                            className={`seg-item ${customGovernance === role ? "active" : ""}`}
                            onClick={() => setCustomGovernance(role as GovernanceRole | null)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Switch: Walk Leader */}
                    <div
                      className="modern-switch-row"
                      onClick={() => setCustomWalkLeader(!customWalkLeader)}
                    >
                      <div className="switch-info">
                        <strong>Walk Leader Privileges</strong>
                        <small>Roster check-ins &amp; route authoring</small>
                      </div>
                      <div className={`modern-switch ${customWalkLeader ? "on" : "off"}`}>
                        <div className="switch-knob" />
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="popover-apply-btn"
                  onClick={handleCustomApply}
                  disabled={loading}
                >
                  {loading ? "Applying Roles..." : "Apply Role Selection"}
                </button>
              </div>
            )}
          </div>

          <div className="popover-divider" />

          {/* Sign Out Option */}
          <div className="popover-footer">
            <form action="/api/auth/logout" method="post" className="popover-logout-form">
              <button type="submit" className="popover-logout-btn">
                <LogOut size={13} />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
