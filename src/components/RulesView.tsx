"use client";

/**
 * DEMO-GRADE ROLE-GATED RULES REFERENCE VIEW
 *
 * Enforcement Officers can inspect all Legal Metrology rules and statutory references.
 * Administrative operations (Edit Rule, Propose Amendment, Engine Toggle) are visibly disabled
 * with a lock icon and tooltip for Officers, and unlocked for Admins.
 */

import { useMemo, useState } from "react";
import { Edit3, ExternalLink, FileText, Lock, Plus, Search, ShieldCheck } from "lucide-react";
import { RULES } from "@/domain/rules";
import { LEGAL_RULE_REGISTRY } from "@/legal/registry";
import { OFFICIAL_LEGAL_METROLOGY_PAGE } from "@/legal/documents";
import type { UserRole } from "./HistoryView";

interface RulesViewProps {
  role: UserRole;
  onSwitchRole: (role: UserRole) => void;
}

export function RulesView({ role }: RulesViewProps) {
  const isAdmin = role === "admin";
  const [selectedTab, setSelectedTab] = useState<"all" | "active" | "inactive" | "archived">("all");

  const ruleStatus = (ruleId: string) => LEGAL_RULE_REGISTRY.find((entry) => entry.ruleId === ruleId);
  const tabRules = useMemo(() => RULES.filter((rule) => {
    const registryRule = ruleStatus(rule.id);
    if (selectedTab === "all") return true;
    if (selectedTab === "active") return registryRule?.status === "active" || registryRule?.status === "provisional";
    if (selectedTab === "archived") return registryRule?.status === "retired";
    return registryRule?.engineEnabled === false;
  }), [selectedTab]);

  const tabCounts = {
    all: RULES.length,
    active: RULES.filter((rule) => {
      const status = ruleStatus(rule.id)?.status;
      return status === "active" || status === "provisional";
    }).length,
    inactive: RULES.filter((rule) => ruleStatus(rule.id)?.engineEnabled === false).length,
    archived: RULES.filter((rule) => ruleStatus(rule.id)?.status === "retired").length,
  };

  return (
    <div className="">
      <section className="rules-reference-hero">
        <div><span>REGULATORY DATABASE</span><h1>Rules Reference &amp; Registry</h1><p>View and manage all legal metrology rules, regulations and reference documents for packaged commodities compliance.</p></div>
        <div className="rules-reference-art" aria-hidden="true"><FileText size={44} /><ShieldCheck size={22} /></div>
      </section>
      <div className="rules-reference-toolbar">
        <label><Search size={16} /><input placeholder="Search rules, rule ID or keyword..." /></label>
        <button className="button primary"><Plus size={14} /> Add Rule</button>
      </div>
      <div className="rules-reference-tabs">
        {(["all", "active", "inactive", "archived"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={selectedTab === tab ? "active" : ""}
            onClick={() => setSelectedTab(tab)}
            aria-pressed={selectedTab === tab}
          >
            {tab === "all" ? "All Rules" : tab[0].toUpperCase() + tab.slice(1)} <b>{tabCounts[tab]}</b>
          </button>
        ))}
      </div>
      <div className="eyebrow">
        REFERENCE / RULESET LM-PC 2011 ({isAdmin ? "ADMIN EDIT ACCESS" : "OFFICER VIEW-ONLY"})
      </div>
      <div className="page-heading rules-legacy-heading">
        <div>
          <h1>Rules Reference & Registry</h1>
          <p>Versioned statutory checks used by the deterministic inspection engine.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="rules-version">v1.1 / ACTIVE</span>
          {isAdmin ? (
            <>
              <span
                className="demo-auth-badge"
                style={{
                  backgroundColor: "#edf7f2",
                  borderColor: "#c4dfcf",
                  color: "var(--green)",
                }}
              >
                <Edit3 size={12} /> Registry Edit Mode (Admin)
              </span>
              <button
                className="button secondary"
                style={{ fontSize: "12px", padding: "6px 10px" }}
                onClick={() => alert("Admin action: Rule amendment modal opened.")}
              >
                <Plus size={13} /> Propose Amendment
              </button>
            </>
          ) : (
            <>
              <span
                className="demo-auth-badge"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "#cbd5e1",
                  color: "var(--ink-soft)",
                }}
                title="Admin role required for registry modification"
              >
                <Lock size={12} /> View-Only (Officer)
              </span>
              <button
                className="button secondary disabled"
                disabled
                style={{
                  opacity: 0.6,
                  cursor: "not-allowed",
                  fontSize: "12px",
                  padding: "6px 10px",
                }}
                title="Admin role required to propose rule amendments"
              >
                <Lock size={12} /> Propose Amendment
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rules-list">
        {tabRules.map((rule, index) => (
          <article className="rule-row" key={rule.id}>
            <span className="rule-number">{String(index + 1).padStart(2, "0")}</span>
            <div style={{ flex: 1 }}>
              <span className="eyebrow">
                {rule.id} /{" "}
                <a
                  href={LEGAL_RULE_REGISTRY.find((entry) => entry.ruleId === rule.id)?.sourceUrl || OFFICIAL_LEGAL_METROLOGY_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rule-citation-link"
                  title="Open official statutory reference in new tab"
                >
                  {rule.reference} <ExternalLink size={10} />
                </a>
              </span>
              <h3>
                {rule.label} <span className={`severity-badge ${rule.severity}`}>{rule.severity}</span>
              </h3>
              <p>{rule.requirement}</p>
              <div className="legal-source-row" style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <small className="legal-source" style={{ margin: 0 }}>
                  Status:{" "}
                  <strong>
                    {LEGAL_RULE_REGISTRY.find((entry) => entry.ruleId === rule.id)?.status === "provisional"
                      ? "PROVISIONAL (REVIEW REQUIRED)"
                      : "ACTIVE (VERIFIED)"}
                  </strong>
                </small>
                <a
                  href={LEGAL_RULE_REGISTRY.find((entry) => entry.ruleId === rule.id)?.sourceUrl || OFFICIAL_LEGAL_METROLOGY_PAGE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="official-source-action"
                  style={{ fontSize: "11px", fontWeight: 600, color: "var(--green)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  View official source ↗
                </a>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {isAdmin ? (
                <button
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "5px 10px" }}
                  onClick={() => alert(`Admin action: Edit rule definition for ${rule.id}`)}
                >
                  <Edit3 size={13} /> Edit Rule
                </button>
              ) : (
                <button
                  className="button secondary disabled"
                  disabled
                  style={{
                    opacity: 0.6,
                    cursor: "not-allowed",
                    fontSize: "12px",
                    padding: "5px 10px",
                  }}
                  title="Admin role required to modify statutory rule definitions"
                >
                  <Lock size={12} /> Edit (Admin)
                </button>
              )}
              <ShieldCheck size={18} style={{ opacity: 0.6 }} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
