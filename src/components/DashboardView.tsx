"use client";

/**
 * DEMO-GRADE DASHBOARD & COMPLIANCE MONITORING VIEW
 *
 * Provides executive and analytical oversight for Legal Metrology inspections:
 * - Aggregate inspection volumes and compliance ratios (Pass / Fail / Review)
 * - Frequency breakdown of top violated rules
 * - Time-series trend chart of inspection decisions over time
 * - Detailed product compliance audit log
 */

import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Download, Lock, Package, ShieldAlert, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Inspection } from "@/domain/inspection";
import { RULES } from "@/domain/rules";
import type { UserRole } from "@/context/RoleContext";

interface DashboardViewProps {
  role?: UserRole;
  inspections: Inspection[];
  onSelectInspection: (inspection: Inspection) => void;
  onDeleteInspection?: (inspection: Inspection) => void;
  isLoading?: boolean;
  onStartInspection?: () => void;
  onFilterByRule?: (ruleId: string) => void;
  onFilterByDate?: (dateKey: string) => void;
}

export function DashboardView({ role = "officer", inspections, onSelectInspection, onDeleteInspection, isLoading = false, onStartInspection, onFilterByRule, onFilterByDate }: DashboardViewProps) {
  const [metricsOpen, setMetricsOpen] = useState(false);
  const stats = useMemo(() => {
    const total = inspections.length;
    const pass = inspections.filter((i) => i.status === "pass").length;
    const fail = inspections.filter((i) => i.status === "fail").length;
    const review = inspections.filter((i) => i.status === "review").length;
    const invalid = inspections.filter((i) => i.status === "invalid_evidence" || i.status === "incomplete").length;
    const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

    // Rule violation frequency across all inspection records
    const ruleViolations: Record<string, { count: number; ruleId: string; field: string }> = {};
    for (const insp of inspections) {
      for (const check of insp.checks || []) {
        if (check.status === "fail" || check.status === "review") {
          if (!ruleViolations[check.ruleId]) {
            ruleViolations[check.ruleId] = { count: 0, ruleId: check.ruleId, field: check.field };
          }
          ruleViolations[check.ruleId].count += 1;
        }
      }
    }

    // Rule 19/20 physical weighing compliance (officer-entered)
    let weighingsDone = 0;
    let weighingsInTolerance = 0;
    let weighingsDeviation = 0;
    let awaitingWeighing = 0;
    // Rule 7(3) character-height calibration status
    let heightEvaluated = 0;
    let heightPending = 0;
    for (const insp of inspections) {
      const physical = insp.physicalMeasurements || [];
      const hasAny = physical.filter((m) => m.measuredValue != null && m.measuredValue !== "").length > 0;
      if (hasAny) {
        weighingsDone += 1;
        if (physical.some((m) => m.withinTolerance === false)) weighingsDeviation += 1;
        else weighingsInTolerance += 1;
      } else if ((insp.checks || []).some((c) => c.validationType === "physical_verification" && c.status === "not_evaluated")) {
        awaitingWeighing += 1;
      }
      const heightChecks = (insp.checks || []).filter((c) => c.validationType === "character_height");
      heightEvaluated += heightChecks.filter((c) => c.status !== "not_evaluated").length;
      heightPending += heightChecks.filter((c) => c.status === "not_evaluated").length;
    }

    const topViolations = Object.values(ruleViolations)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((item) => {
        const ruleDef = RULES.find((r) => r.id === item.ruleId);
        return {
          ...item,
          label: ruleDef?.label || item.field,
          reference: ruleDef?.reference || item.ruleId,
          severity: ruleDef?.severity || "major",
        };
      });

    // Timeline grouping by date
    const timelineMap = new Map<string, { date: string; dateKey: string; pass: number; fail: number; review: number; invalid: number; total: number }>();
    for (const insp of [...inspections].reverse()) {
      const d = new Date(insp.createdAt);
      const dateKey = isNaN(d.getTime())
        ? "Today"
        : new Intl.DateTimeFormat("en-IN", { month: "short", day: "2-digit" }).format(d);

      const existing = timelineMap.get(dateKey) || { date: dateKey, dateKey: insp.createdAt, pass: 0, fail: 0, review: 0, invalid: 0, total: 0 };
      if (insp.status === "pass") existing.pass += 1;
      else if (insp.status === "fail") existing.fail += 1;
      else if (insp.status === "invalid_evidence" || insp.status === "incomplete") (existing as { invalid: number }).invalid += 1;
      else existing.review += 1;
      existing.total += 1;
      timelineMap.set(dateKey, existing);
    }

    const timeline = Array.from(timelineMap.values()).slice(-7);
    const maxDayTotal = Math.max(...timeline.map((t) => t.total), 1);

    return {
      total,
      pass,
      fail,
      review,
      invalid,
      passRate,
      topViolations,
      timeline,
      maxDayTotal,
      weighingsDone,
      weighingsInTolerance,
      weighingsDeviation,
      awaitingWeighing,
      heightEvaluated,
      heightPending,
    };
  }, [inspections]);

  const referenceViolations = [
    { ruleId: "LM-PC-19", label: "Net Weight Declaration Missing", count: 42, percentage: 32, color: "blue" },
    { ruleId: "LM-PC-06", label: "Incorrect MRP Format", count: 28, percentage: 21, color: "cyan" },
    { ruleId: "LM-PC-09", label: "Missing Manufacturer Details", count: 19, percentage: 14, color: "purple" },
    { ruleId: "LM-PC-07", label: "Labeling Language Issue", count: 13, percentage: 10, color: "orange" },
    { ruleId: "OTHER", label: "Others", count: 11, percentage: 8, color: "slate" },
  ];

  const dashboardStats = inspections.length ? stats : {
    ...stats,
    total: 248,
    pass: 226,
    passRate: 91,
    fail: 12,
    review: 6,
    invalid: 4,
    weighingsDone: 7,
    weighingsInTolerance: 7,
    weighingsDeviation: 0,
    awaitingWeighing: 0,
    heightEvaluated: 7,
    heightPending: 0,
    timeline: [
      { date: "Sep 14", dateKey: "2026-09-14", pass: 32, fail: 2, review: 1, invalid: 0, total: 35 },
      { date: "Sep 15", dateKey: "2026-09-15", pass: 36, fail: 2, review: 1, invalid: 0, total: 39 },
      { date: "Sep 16", dateKey: "2026-09-16", pass: 42, fail: 3, review: 1, invalid: 0, total: 46 },
      { date: "Sep 17", dateKey: "2026-09-17", pass: 51, fail: 2, review: 2, invalid: 0, total: 55 },
      { date: "Sep 18", dateKey: "2026-09-18", pass: 44, fail: 3, review: 1, invalid: 0, total: 48 },
      { date: "Sep 19", dateKey: "2026-09-19", pass: 48, fail: 2, review: 1, invalid: 0, total: 51 },
      { date: "Sep 20", dateKey: "2026-09-20", pass: 43, fail: 2, review: 1, invalid: 0, total: 46 },
    ],
  };

  const referenceAuditRows = [
    ["INSP-2026-0912-001", "Sunflower Oil 1L", "92/100", "Compliant"],
    ["INSP-2026-0912-002", "Wheat Flour 5kg", "76/100", "Review Required"],
    ["INSP-2026-0912-003", "Milk Powder 500g", "88/100", "Compliant"],
    ["INSP-2026-0912-004", "Spices Mix 100g", "64/100", "Non-Compliant"],
    ["INSP-2026-0912-005", "Biscuits 200g", "95/100", "Compliant"],
  ];

  function csvCell(value: unknown): string {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function declarationValue(inspection: Inspection, field: string): string {
    return inspection.declarations.find((declaration) => declaration.field === field)?.value || "";
  }

  function exportDataset() {
    const headers = [
      "Product Name", "Inspection Date/Time", "MRP", "Net Quantity",
      "Manufacturing Date", "Best Before/Expiry Date", "Compliance Status",
      "Issues Detected", "Processing Time",
    ];
    const rows = inspections.map((inspection) => {
      const issues = inspection.checks
        .filter((check) => check.status === "fail" || check.status === "review")
        .map((check) => check.explanation || check.ruleId)
        .join(" | ");
      return [
        inspection.productName || "",
        inspection.createdAt,
        declarationValue(inspection, "mrp"),
        declarationValue(inspection, "net_quantity"),
        declarationValue(inspection, "date"),
        declarationValue(inspection, "best_before"),
        inspection.verdict || inspection.status,
        issues,
        inspection.processing?.totalMs != null ? `${(inspection.processing.totalMs / 1000).toFixed(2)}s` : "",
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inspectra-inspections-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const liveMetrics = useMemo(() => {
    const today = new Date();
    const isToday = (value: string) => {
      const date = new Date(value);
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    };
    const completed = inspections.filter((inspection) => inspection.status !== "processing");
    const compliant = inspections.filter((inspection) => inspection.status === "pass").length;
    const nonCompliant = inspections.filter((inspection) => inspection.status === "fail").length;
    const needsReview = inspections.filter((inspection) => inspection.status === "review" || inspection.status === "incomplete").length;
    const processingTimes = inspections.map((inspection) => inspection.processing?.totalMs).filter((value): value is number => typeof value === "number");
    const confidences = inspections.flatMap((inspection) => inspection.declarations)
      .map((declaration) => declaration.confidence)
      .filter((value): value is number => typeof value === "number");
    return {
      totalScans: inspections.length,
      compliant,
      nonCompliant,
      needsReview,
      today: inspections.filter((inspection) => isToday(inspection.createdAt)).length,
      complianceRate: completed.length ? Math.round((compliant / completed.length) * 100) : 0,
      averageProcessing: processingTimes.length ? `${(processingTimes.reduce((sum, value) => sum + value, 0) / processingTimes.length / 1000).toFixed(2)}s` : "N/A",
      ocrAccuracy: confidences.length ? `${Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100)}%` : "N/A",
      imagesProcessed: inspections.reduce((sum, inspection) => sum + inspection.images.length, 0),
    };
  }, [inspections]);

  if (isLoading) {
    return (
      <div className="dashboard-page dashboard-loading">
        <div className="eyebrow">MONITORING CONSOLE / COMPLIANCE ANALYTICS</div>
        <div className="page-heading">
          <div>
            <h1>Inspection Dashboard</h1>
            <p>Real-time monitoring of product compliance, Legal Metrology violations, and market risk trends.</p>
          </div>
          <div className="demo-auth-badge">
            <BarChart3 size={13} /> FETCHING NODE
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "45%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "30%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "60%", height: "12px" }} />
          </div>
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "50%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "35%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "65%", height: "12px" }} />
          </div>
          <div className="metric skeleton-card">
            <div className="skeleton-box" style={{ width: "55%", height: "14px" }} />
            <div className="skeleton-box" style={{ width: "25%", height: "36px", margin: "12px 0 6px" }} />
            <div className="skeleton-box" style={{ width: "50%", height: "12px" }} />
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="skeleton-card" style={{ minHeight: "220px" }}>
            <div className="skeleton-box" style={{ width: "40%", height: "18px" }} />
            <div className="skeleton-box" style={{ width: "70%", height: "12px" }} />
            <div className="skeleton-box" style={{ width: "100%", height: "110px", marginTop: "16px" }} />
          </div>
          <div className="skeleton-card" style={{ minHeight: "220px" }}>
            <div className="skeleton-box" style={{ width: "35%", height: "18px" }} />
            <div className="skeleton-box" style={{ width: "65%", height: "12px" }} />
            <div className="skeleton-box" style={{ width: "100%", height: "110px", marginTop: "16px" }} />
          </div>
        </div>

        <div className="recent-panel skeleton-card" style={{ marginTop: "16px" }}>
          <div className="skeleton-box" style={{ width: "30%", height: "18px" }} />
          <div className="skeleton-row" style={{ marginTop: "12px" }}><div className="skeleton-box" style={{ width: "100%", height: "20px" }} /></div>
          <div className="skeleton-row"><div className="skeleton-box" style={{ width: "100%", height: "20px" }} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="">
      <div className="dashboard-hero-row">
        <section className="dashboard-hero" aria-label="Analytics overview">
          <div>
            <span className="dashboard-hero-kicker">WELCOME TO INSPECTRA</span>
            <h2>Analytics Dashboard</h2>
            <p>Overview of inspection results, compliance metrics and key insights from your package analysis.</p>
          </div>
          <div className="dashboard-hero-art" aria-hidden="true">
            <div className="dashboard-package-art">
              <b className="dashboard-package-box"><Package size={28} strokeWidth={1.8} /></b>
              <b className="dashboard-package-float package-float-one" />
              <b className="dashboard-package-float package-float-two" />
              <b className="dashboard-package-float package-float-three" />
              <span className="dashboard-package-check"><ShieldCheck size={18} /></span>
              <b className="dashboard-package-leaf" />
            </div>
          </div>
        </section>
        <div className="dashboard-hero-actions">
          {role === "admin" ? (
            <button
              className="button secondary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
              onClick={exportDataset}
            >
              <Download size={14} /> Export Dataset
            </button>
          ) : (
            <button
              className="button secondary disabled"
              disabled
              style={{ opacity: 0.6, cursor: "not-allowed", fontSize: "12px", padding: "6px 12px" }}
              title="🔒 Admin role required — Switch to Admin in top bar to export raw compliance dataset"
            >
              <Lock size={12} /> Export Dataset (Admin Only)
            </button>
          )}
          <button
            type="button"
            className="demo-auth-badge"
            onClick={() => setMetricsOpen(true)}
            aria-haspopup="dialog"
            aria-label="Open live inspection metrics"
            style={{ cursor: "pointer", border: "1px solid var(--border)", font: "inherit" }}
          >
            <BarChart3 size={13} /> LIVE METRICS NODE
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="metric-grid">
        <div className="metric metric-ink">
          <span>Total Scans Evaluated</span>
          <strong>{dashboardStats.total}</strong>
          <small>100% engine verified</small>
        </div>
        <div className="metric metric-green">
          <span>Pass Rate (Compliant)</span>
          <strong>{dashboardStats.passRate}%</strong>
          <small>{dashboardStats.pass} compliant commodities</small>
        </div>
        <div className="metric metric-amber">
          <span>Non-Compliant / Review</span>
          <strong>{dashboardStats.fail + dashboardStats.review}</strong>
          <small>{dashboardStats.fail} failed · {dashboardStats.review} under review</small>
        </div>
        <div className="metric metric-ink">
          <span>Invalid Evidence</span>
          <strong>{dashboardStats.invalid}</strong>
          <small>no package detected · recapture required</small>
        </div>
        <div className="metric metric-green">
          <span>Rule 19/20 Weighing</span>
          <strong>{dashboardStats.weighingsDone} / {dashboardStats.total || 0}</strong>
          <small>{dashboardStats.weighingsInTolerance} in tolerance · {dashboardStats.weighingsDeviation} deviation · {dashboardStats.awaitingWeighing} awaiting</small>
        </div>
        <div className="metric metric-amber">
          <span>Rule 7(3) Height Checks</span>
          <strong>{dashboardStats.heightEvaluated} / {dashboardStats.heightEvaluated + dashboardStats.heightPending || 0}</strong>
          <small>{dashboardStats.heightPending} pending physical-scale calibration</small>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Top Violated Rules Breakdown */}
        <section className="chart-card">
          <div className="chart-header">
            <div>
              <h3>Most Common Rule Violations</h3>
              <p>Frequency of non-compliance flags under Legal Metrology Rules, 2011</p>
            </div>
            <button className="dashboard-view-all" type="button">View All <ChevronRight size={14} /></button>
          </div>

          <div className="violation-list">
            {stats.topViolations.length > 0 ? (
              stats.topViolations.map((v) => {
                const percentage = Math.round((v.count / Math.max(stats.total, 1)) * 100);
                return (
                  <div key={v.ruleId} className="violation-item" onClick={() => onFilterByRule?.(v.ruleId)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onFilterByRule?.(v.ruleId)}>
                    <div className="violation-meta">
                      <span>
                        <b>{v.ruleId}</b> — {v.label}
                        <span className={`severity-badge ${v.severity}`}>{v.severity}</span>
                      </span>
                      <span>{v.count} flags ({percentage}%)</span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className={`progress-bar-fill ${v.severity === "critical" ? "fail" : "review"}`}
                        style={{ width: `${Math.min(100, Math.max(12, percentage * 2))}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : referenceViolations.map((v) => (
              <div key={v.ruleId} className={`violation-item reference-violation ${v.color}`}>
                <div className="violation-meta">
                  <span><b>{v.label}</b></span>
                  <span>{v.count}</span>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${v.percentage * 2.8}%` }} />
                </div>
                <span className="reference-violation-percent">{v.percentage}%</span>
              </div>
            ))}
          </div>
        </section>

        {/* Inspection Activity Timeline Chart */}
        <section className="chart-card">
          <div className="chart-header">
            <div>
              <h3>Inspection Trend</h3>
              <p>Daily inspection volume</p>
            </div>
            <BarChart3 size={18} className="muted-icon" />
          </div>

          {dashboardStats.timeline.length > 0 ? (
            <div
              style={{
                width: "100%",
                height: "250px",
                marginTop: "14px",
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={dashboardStats.timeline}
                  margin={{
                    top: 10,
                    right: 10,
                    left: 0,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e5e7eb"
                  />

                  <XAxis
                    dataKey="date"
                    tick={{
                      fontSize: 12,
                      fill: "#64748b",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <YAxis
                    allowDecimals={false}
                    domain={[0, "auto"]}
                    tick={{
                      fontSize: 12,
                      fill: "#64748b",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />

                  <Tooltip
                    contentStyle={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      boxShadow: "0 5px 12px rgba(15, 23, 42, 0.08)",
                    }}
                    labelStyle={{
                      color: "#172554",
                      fontWeight: 600,
                      fontSize: "13px",
                      marginBottom: "4px",
                    }}
                    itemStyle={{
                      color: "#4f8df7",
                      fontSize: "12px",
                      padding: "0",
                    }}
                    formatter={(value) => [value, "Inspections"]}
                  />

                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Inspections"
                    stroke="#4f8df7"
                    strokeWidth={3}
                    dot={{
                      r: 5,
                      fill: "#4f8df7",
                      stroke: "#ffffff",
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 7,
                      fill: "#4f8df7",
                      stroke: "#ffffff",
                      strokeWidth: 2,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-row">
              <BarChart3 size={18} />
              <span>Inspection volume timeline will populate as scans are saved.</span>
            </div>
          )}
        </section>
      </div>

      {/* Monitored Products Table */}
      <section className="recent-panel" style={{ marginTop: "16px" }}>
        <div className="panel-title" style={{ marginBottom: "16px" }}>
          <div>
            <span className="eyebrow">MONITORED COMMODITIES</span>
            <h3>Product Compliance Audit Log</h3>
          </div>
          <span className="muted">Showing recent inspections</span>
        </div>

        <div className="history-table">
          <div className="history-header">
            <span>Inspection</span>
            <span>Commodity Name</span>
            <span>Score</span>
            <span>Status</span>
            <span>Scanned</span>
            <span />
          </div>
          {inspections.length ? (
            inspections.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="history-row"
                role="button"
                tabIndex={0}
                onClick={() => onSelectInspection(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectInspection(item);
                  }
                }}
              >
                <span className="history-id">
                  <span className="history-icon">
                    {item.status === "pass" ? <CheckCircle2 size={16} /> : item.status === "fail" ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <b>{item.id}</b>
                </span>
                <span>{item.productName || "Unnamed commodity"}</span>
                <span style={{ fontWeight: 600 }}>{item.score !== undefined ? `${item.score}/100` : "-"}</span>
                {item.extractionSource === "local_offline_ocr" ? (
                  <span className="status-word review" style={{ backgroundColor: "#fff2df", color: "#995910", borderColor: "#fbd99d", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.72rem" }}>
                    Provisional — awaiting network
                  </span>
                ) : (
                  <span className={`status-word ${item.status}`}>{item.status.toUpperCase()}</span>
                )}
                <span>{new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <ChevronRight size={16} />
                  {role === "admin" && onDeleteInspection && (
                    <button
                      type="button"
                      className="archive-delete-action"
                      aria-label={`Delete inspection ${item.id}`}
                      title="Delete this inspection"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteInspection(item);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
            ))
          ) : referenceAuditRows.map(([id, product, score, status]) => (
            <div className="history-row dashboard-reference-row" key={id}>
              <span className="history-id"><span className="history-icon"><BarChart3 size={15} /></span><b>{id}</b></span>
              <span>{product}</span>
              <span style={{ fontWeight: 600 }}>{score}</span>
              <span className={`status-word ${status === "Compliant" ? "pass" : status === "Review Required" ? "review" : "fail"}`}>{status}</span>
              <span>Sep 20, 2026</span>
              <ChevronRight size={16} />
            </div>
          ))}
        </div>
      </section>

      {metricsOpen && (
        <div
          role="presentation"
          onClick={() => setMetricsOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: "20px", background: "rgba(10, 25, 52, 0.35)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-metrics-title"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(560px, 100%)", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--surface, #fff)", boxShadow: "0 24px 70px rgba(10, 25, 52, 0.2)", padding: "24px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "16px", marginBottom: "20px" }}>
              <div>
                <span className="eyebrow">LIVE METRICS NODE</span>
                <h2 id="live-metrics-title" style={{ margin: "6px 0 0" }}>Inspection performance</h2>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>Calculated from the inspections currently loaded.</p>
              </div>
              <button type="button" className="button secondary" onClick={() => setMetricsOpen(false)} aria-label="Close live metrics">Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
              {[
                ["Total Scans", liveMetrics.totalScans],
                ["Compliant Count", liveMetrics.compliant],
                ["Non-Compliant Count", liveMetrics.nonCompliant],
                ["Needs Review Count", liveMetrics.needsReview],
                ["Today's Inspections", liveMetrics.today],
                ["Compliance Rate", `${liveMetrics.complianceRate}%`],
                ["Average Processing Time", liveMetrics.averageProcessing],
                ["OCR Accuracy", liveMetrics.ocrAccuracy],
                ["Images Processed", liveMetrics.imagesProcessed],
              ].map(([label, value]) => (
                <div key={label} style={{ border: "1px solid var(--border)", borderRadius: "9px", padding: "12px 14px", background: "var(--surface-soft, #f8fafc)" }}>
                  <small style={{ display: "block", color: "var(--muted)", marginBottom: "5px" }}>{label}</small>
                  <strong style={{ fontSize: "18px" }}>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Storage Infrastructure Footer */}
      <footer style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)" }}>
        <span>Persistence Engine: <strong style={{ color: "var(--fg)" }}>SQLite</strong> (embedded via Prisma ORM)</span>
        <span><strong>{dashboardStats.total}</strong> inspections shown</span>
      </footer>
    </div>
  </div>
  );
}
