"use client";

/**
 * CREDENTIALED DUAL-PORTAL ARCHITECTURE
 *
 * Genuinely differentiated experiences for Officer and Admin portals:
 * - Officer Portal: Field inspection & image capture workflow (landing: scan)
 * - Admin Portal: Dashboard analytics & rules management (landing: dashboard)
 *
 * Authenticated via signed HttpOnly session cookies.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  BarChart3,
  Camera,
  ChevronRight,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { AnalysisPhase, ComplianceCheck, Inspection, InspectionStatus } from "@/domain/inspection";
import { HomeView } from "@/components/HomeView";
import { ScanView } from "@/components/ScanView";
import { ResultView } from "@/components/ResultView";
import { HistoryView } from "@/components/HistoryView";
import { RulesView } from "@/components/RulesView";
import { SettingsView } from "@/components/SettingsView";
import { DashboardView } from "@/components/DashboardView";
import { LoginView } from "@/components/LoginView";
import { useRole } from "@/context/RoleContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { compressAndDownscaleImage } from "@/services/image-compression";
import { startSyncEngine } from "@/services/sync-engine";

type View = "home" | "dashboard" | "scan" | "result" | "history" | "rules" | "settings";



function newInspection() {
  return {
    id: "DRAFT",
    createdAt: new Date().toISOString(),
    status: "processing" as InspectionStatus,
    images: [],
    declarations: [],
    checks: [],
    notes: [],
  } satisfies Inspection;
}

export default function Home() {
  const { user, role, isAuthenticated, isLoadingAuth, login, logout, isAdmin } = useRole();
  const [view, setView] = useState<View>("scan");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [selectedInspectionIndex, setSelectedInspectionIndex] = useState(0);
  const [phase, setPhase] = useState<AnalysisPhase>("image");
  const [selectedCheck, setSelectedCheck] = useState<ComplianceCheck | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [fileName, setFileName] = useState("No image selected");
  const [activeFiles, setActiveFiles] = useState<File[]>([]);
  const activeFilesRef = useRef<File[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [savedInspections, setSavedInspections] = useState<Inspection[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [dashboardFilterRule, setDashboardFilterRule] = useState<string | null>(null);
  const [dashboardFilterDate, setDashboardFilterDate] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [isTimeout, setIsTimeout] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const isAnalyzingRef = useRef<boolean>(false);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const initialViewSetRef = useRef<boolean>(false);
  const currentInspectionIdRef = useRef<string | undefined>(inspection?.id);

  useEffect(() => {
    currentInspectionIdRef.current = inspection?.id;
  }, [inspection?.id]);

  // Clean up staged object URLs and abort in-flight requests only when unmounting
  useEffect(() => {
    return () => {
      analyzeAbortRef.current?.abort();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  // Set default role landing view once authenticated
  useEffect(() => {
    if (isAuthenticated && !initialViewSetRef.current) {
      initialViewSetRef.current = true;
      if (isAdmin) {
        setView("dashboard");
      } else {
        startInspection();
      }
    }
  }, [isAuthenticated, isAdmin]);

  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch("/api/scan");
      if (res.ok) {
        const data = await res.json();
        setSavedInspections(data.inspections || []);
      }
    } catch (e) {
      console.error("Failed to fetch history", e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchHistory();

      // Start background sync engine for offline pending_sync re-verification
      const stopSync = startSyncEngine({
        onRecordSynced: (updatedInspection) => {
          setSavedInspections((prev) =>
            prev.map((item) => (item.id === updatedInspection.id ? updatedInspection : item)),
          );
          if (currentInspectionIdRef.current === updatedInspection.id) {
            setInspection(updatedInspection);
          }
          setInspections((prev) => prev.map((item) => item.id === updatedInspection.id ? updatedInspection : item));
        },
      });

      return () => {
        stopSync();
      };
    }
  }, [isAuthenticated, fetchHistory]);

  const counts = useMemo(() => {
    const checks = inspection?.checks || [];
    return {
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
      review: checks.filter((c) => c.status === "review").length,
    };
  }, [inspection]);

  function startInspection() {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    setInspection(newInspection());
    setInspections([]);
    setSelectedInspectionIndex(0);
    setSelectedCheck(null);
    setReportOpen(false);
    setPhase("image");
    setErrorMsg(null);
    setIsTimeout(false);
    setElapsed(0);
    activeFilesRef.current = [];
    setActiveFiles([]);
    setFileName("No image selected");
    setView("scan");
  }

  async function selectFiles(files: File[], append = false) {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsTimeout(false);
    const baseInspection = inspection || newInspection();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    const originalTotalBytes = files.reduce((acc, f) => acc + f.size, 0);

    const compressedFiles = await Promise.all(
      files.map((file) => compressAndDownscaleImage(file, file.name, 1600, 0.85)),
    );

    const compressedTotalBytes = compressedFiles.reduce((acc, f) => acc + f.size, 0);
    const reductionPct = originalTotalBytes > 0 ? Math.round((1 - compressedTotalBytes / originalTotalBytes) * 100) : 0;

    console.log(
      `[ClientUpload] Prepared ${files.length} file(s): Original total ${(originalTotalBytes / 1024).toFixed(1)} KB -> Compressed total ${(compressedTotalBytes / 1024).toFixed(1)} KB [-${reductionPct}%]`,
    );

    const nextFiles = append ? [...activeFilesRef.current, ...compressedFiles] : compressedFiles;
    setFileName(nextFiles.length === 1 ? nextFiles[0].name : `${nextFiles.length} package images`);
    activeFilesRef.current = nextFiles;
    setActiveFiles(nextFiles);

    const newUrls = nextFiles.map((file, i) => ({
      id: `pending-image-${i}`,
      uri: URL.createObjectURL(file),
      side: (i === 0 ? "front" : "unknown") as "front" | "unknown",
      width: 1600,
      height: 1200,
    }));
    objectUrlsRef.current = newUrls.map((img) => img.uri);
    setInspection({ ...baseInspection, images: newUrls });
  }

  function updateActiveFiles(nextFiles: File[]) {
    const baseInspection = inspection || newInspection();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    setFileName(
      nextFiles.length === 0
        ? "No image selected"
        : nextFiles.length === 1
        ? nextFiles[0].name
        : `${nextFiles.length} package images`
    );
    activeFilesRef.current = nextFiles;
    setActiveFiles(nextFiles);

    const newUrls = nextFiles.map((file, i) => ({
      id: `pending-image-${i}`,
      uri: URL.createObjectURL(file),
      side: (i === 0 ? "front" : "unknown") as "front" | "unknown",
      width: 1600,
      height: 1200,
    }));
    objectUrlsRef.current = newUrls.map((img) => img.uri);
    setInspection({ ...baseInspection, images: newUrls });
  }

  async function analyzeSeparateFiles(files: File[]) {
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setIsTimeout(false);
    setElapsed(0);
    setPhase("image");
    const startedAt = Date.now();
    elapsedRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      const analyzeOne = async (file: File, index: number): Promise<Inspection> => {
        const formData = new FormData();
        formData.append("image", file);
        formData.append("side", "front");
        console.log(`[ScanAnalyze] Sending inspection ${index + 1}/${files.length}...`);
        const response = await fetch("/api/scan", { method: "POST", body: formData, signal: controller.signal });
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!data) throw new Error(`Server returned invalid response (HTTP ${response.status}). Please try again.`);

        if (response.status === 202) {
          const statusUrl = (data as { statusUrl?: string }).statusUrl;
          if (!statusUrl) throw new Error("Queue accepted the inspection but returned no status URL.");
          setPhase("text");
          let missingCount = 0;
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            let poll: Response;
            try {
              poll = await fetch(statusUrl, { signal: controller.signal });
            } catch (error) {
              if ((error as DOMException)?.name === "AbortError") throw error;
              continue;
            }
            if (poll.status === 404) {
              missingCount++;
              if (missingCount >= 15) throw new Error("Analysis worker has not picked up the inspection. Start one with `npm run worker`, then retry.");
              continue;
            }
            if (!poll.ok) continue;
            missingCount = 0;
            const payload = (await poll.json()) as { inspection?: Inspection; job?: { status?: string; error?: string } | null };
            const result = payload.inspection;
            const jobStatus = payload.job?.status;
            if (result?.processingStatus === "OCR_PROCESSING" || result?.processingStatus === "EXTRACTING_FIELDS" || result?.processingStatus === "EXTRACTING") setPhase("declarations");
            else if (result?.processingStatus === "VALIDATING" || result?.processingStatus === "COMPLIANCE_ANALYSIS") setPhase("rules");
            if (jobStatus === "FAILED" && (!result || result.status === "processing")) throw new Error(payload.job?.error || "Analysis worker failed. Please retry.");
            const terminal = !!result && result.processingStatus !== undefined && !["UPLOADING", "QUEUED", "PROCESSING", "DETECTING_PACKAGE", "DETECTING_DECLARATIONS", "OCR_PROCESSING", "EXTRACTING_FIELDS", "VALIDATING", "COMPLIANCE_ANALYSIS", "DETECTING", "EXTRACTING"].includes(result.processingStatus) && result.status !== "processing";
            if (result && (terminal || jobStatus === "COMPLETED")) return result;
          }
        }

        if (!response.ok) {
          const error = (data as { error?: string }).error;
          throw new Error((data as { message?: string }).message || error || "Analysis failed");
        }
        const result = (data as { inspection?: Inspection }).inspection;
        if (!result) throw new Error("Analysis completed but returned no inspection data. Please try again.");
        return result;
      };

      const results = await Promise.all(files.map(analyzeOne));
      setInspections(results);
      setSelectedInspectionIndex(0);
      setInspection(results[0]);
      setPhase("complete");
      setView("result");
      fetchHistory();
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      setIsTimeout(isTimeout);
      setErrorMsg(isTimeout ? "Analysis could not return a result. Check Recent Analyses or retry." : error instanceof Error ? error.message : String(error));
    } finally {
      analyzeAbortRef.current = null;
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    }
  }

  async function analyze() {
    if (isAnalyzingRef.current) {
      console.warn("[ScanAnalyze] Analysis already in progress. Ignoring duplicate trigger.");
      return;
    }

    if (!activeFiles.length) {
      setErrorMsg("Select a package image or capture one with the camera before analyzing.");
      return;
    }

    await analyzeSeparateFiles([...activeFiles]);
    return;
  }

  function retryAnalysis() {
    setIsTimeout(false);
    setErrorMsg(null);
    setElapsed(0);
    analyze();
  }

  function chooseFinding(check: ComplianceCheck) {
    setSelectedCheck(check);
    document.querySelector(".evidence-stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openInspectionResult(item: Inspection) {
    setInspections([item]);
    setSelectedInspectionIndex(0);
    setInspection(item);
    setView("result");
  }

  function saveInspection() {
    if (inspection) setReportOpen(true);
  }

  async function purgeArchive() {
    if (role !== "admin") return;
    if (!confirm("Admin confirmation: Purge all local inspection archive records?")) return;
    try {
      const res = await fetch("/api/inspections", { method: "DELETE" });
      if (res.ok) {
        setSavedInspections([]);
      } else {
        const data = await res.json();
        alert(`Action rejected: ${data.error || "403 Forbidden"}`);
      }
    } catch (e) {
      console.error("Purge error", e);
    }
  }

  async function deleteInspection(item: Inspection) {
    if (role !== "admin") return;
    if (!confirm(`Delete inspection ${item.id}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/inspections/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Delete failed: ${data.error || "Unable to delete inspection."}`);
        return;
      }
      setSavedInspections((current) => current.filter((inspectionItem) => inspectionItem.id !== item.id));
      setInspections((current) => current.filter((inspectionItem) => inspectionItem.id !== item.id));
      if (inspection?.id === item.id) {
        setInspection(null);
        setView("history");
      }
    } catch (error) {
      console.error("Delete inspection error", error);
      alert("Delete failed. Please try again.");
    }
  }

  // 1. Loading Authentication State
  if (isLoadingAuth) {
    return (
      <main className="login-portal-wrapper">
        <div style={{ textAlign: "center", color: "white" }}>
          <ScanLine size={42} className="spin-soft" style={{ marginBottom: "16px", color: "#4ade80" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Inspectra Enforcement System</h2>
          <p style={{ fontSize: "13px", color: "#94a3b8", marginTop: "6px" }}>Authenticating secure console session…</p>
        </div>
      </main>
    );
  }

  // 2. Unauthenticated Login Gate
  if (!isAuthenticated || !user) {
    return (
      <LoginView
        onLoginSuccess={(loggedInUser) => {
          login(loggedInUser);
          if (loggedInUser.role === "admin") {
            setView("dashboard");
          } else {
            startInspection();
          }
        }}
      />
    );
  }

  const navCls = (v: View) => (view === v ? "nav-item active" : "nav-item");
  const inspectNav = view === "scan" || view === "result" ? "nav-item active" : "nav-item";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <ScanLine size={18} />
          </span>
          <div>
            <span style={{ display: "block", fontWeight: 700, fontSize: "14px", lineHeight: 1.2 }}>
              {isAdmin ? "Inspectra Admin" : "Inspectra Officer"}
            </span>
            <small style={{ fontSize: "8.5px", color: "var(--ink-muted)", letterSpacing: "0.08em" }}>
              {isAdmin ? "CONTROL CENTER" : "FIELD CONSOLE"}
            </small>
          </div>
        </div>

        <div style={{ padding: "0 12px 8px" }}>
          <span className={`portal-indicator-banner ${role}`}>
            {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
            {isAdmin ? "Admin Console" : "Officer Portal"}
          </span>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {isAdmin ? (
            <>
              <button className={navCls("dashboard")} onClick={() => { fetchHistory(); setView("dashboard"); }}>
                <LayoutDashboard size={17} /> Dashboard
              </button>
              <button className={inspectNav} onClick={() => (inspection ? setView(inspection.status === "processing" ? "scan" : "result") : startInspection())}>
                <Camera size={17} /> Evidence Capture
              </button>
              <button className={navCls("history")} onClick={() => { fetchHistory(); setView("history"); }}>
                <ScanLine size={17} /> Run Investigation <span className="nav-count">{savedInspections.length}</span>
              </button>
              <button className={navCls("rules")} onClick={() => setView("rules")}>
                <BarChart3 size={17} /> Analysis &amp; Reports
              </button>
              <button className={navCls("settings")} type="button" onClick={() => setView("settings")}>
                <ShieldCheck size={17} /> Settings
              </button>
            </>
          ) : (
            <>
              <button className={inspectNav} onClick={() => (inspection ? setView(inspection.status === "processing" ? "scan" : "result") : startInspection())}>
                <Camera size={17} /> Scan & Inspect
              </button>
              <button className={navCls("history")} onClick={() => { fetchHistory(); setView("history"); }}>
                <History size={17} /> Inspection History <span className="nav-count">{savedInspections.length}</span>
              </button>
              <button className={navCls("rules")} onClick={() => setView("rules")}>
                <ShieldCheck size={17} /> Rules Reference
              </button>
              <button className={navCls("home")} onClick={() => setView("home")}>
                <ClipboardCheck size={17} /> Overview
              </button>
            </>
          )}
        </nav>

        {/* Authenticated User Profile & Logout */}
        <div className="sidebar-user-footer">
          <div className="user-profile-card">
            <div className={`user-avatar-badge ${role}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="user-info-text">
              <span className="user-display-name" title={user.name}>{user.name}</span>
              <span className="user-role-label">@{user.username} · {role.toUpperCase()}</span>
            </div>
          </div>
          <button className="logout-action-btn" onClick={logout} title="End active session and return to login">
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            {isAdmin ? "Admin Console" : "Officer Enforcement Console"} <ChevronRight size={14} />{" "}
            <strong>
              {view === "home"
                ? "Overview"
                : view === "dashboard"
                ? "Analytics Dashboard"
                : view === "scan"
                ? isAdmin ? "Evidence Capture Console" : "Package Scanner"
                : view === "result"
                ? "Compliance Result"
                : view === "history"
                ? "Inspection Archive"
                : view === "settings"
                ? "Settings"
                : "Rules Reference"}
            </strong>
          </div>
          <div className="topbar-meta">
            <span className="live-indicator">
              <span className="status-dot" /> Session Active
            </span>
            <span className={`role-badge ${role}`}>
              {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
              {isAdmin ? "Administrator" : "Enforcement Officer"}
            </span>
          </div>
        </header>

        <div className="content">
          <ErrorBoundary>
            {view === "home" && <HomeView role={role} onStart={startInspection} saved={savedInspections} onHistory={() => setView("history")} onClearHistory={purgeArchive} />}
            {view === "dashboard" && (
              <DashboardView
                role={role}
                inspections={savedInspections}
                isLoading={isLoadingHistory}
                onStartInspection={startInspection}
                onFilterByRule={(ruleId) => {
                  setDashboardFilterRule(ruleId);
                  setDashboardFilterDate(null);
                  setView("history");
                }}
                onFilterByDate={(dateKey) => {
                  setDashboardFilterDate(dateKey);
                  setDashboardFilterRule(null);
                  setView("history");
                }}
                onDeleteInspection={deleteInspection}
                onSelectInspection={(item) => {
                  openInspectionResult(item);
                }}
              />
            )}
            {view === "scan" && (
              <ScanView
                role={role}
                inspection={inspection}
                phase={phase}
                fileName={fileName}
                onUpload={() => fileInput.current?.click()}
                onFiles={selectFiles}
                onAnalyze={analyze}
                inputRef={fileInput}
                errorMsg={errorMsg}
                onDismissError={() => setErrorMsg(null)}
                elapsed={elapsed}
                isTimeout={isTimeout}
                onRetry={retryAnalysis}
                activeFiles={activeFiles}
                onUpdateFiles={updateActiveFiles}
                isAnalyzing={isAnalyzing}
                recentInspections={savedInspections}
                onOpenInspection={(item) => {
                  openInspectionResult(item);
                }}
              />
            )}
            {view === "result" && inspection && (
              <>
                {inspections.length > 1 && (
                  <div role="tablist" aria-label="Inspection results" style={{ display: "flex", gap: "6px", overflowX: "auto", marginBottom: "14px", paddingBottom: "2px" }}>
                    {inspections.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={index === selectedInspectionIndex}
                        onClick={() => {
                          setSelectedInspectionIndex(index);
                          setInspection(item);
                          setSelectedCheck(null);
                        }}
                        style={{ padding: "7px 11px", border: "1px solid var(--line)", borderRadius: "6px", background: index === selectedInspectionIndex ? "var(--ink)" : "white", color: index === selectedInspectionIndex ? "white" : "var(--ink-soft)", cursor: "pointer", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 600 }}
                      >
                        {item.productName || item.images?.[0]?.filename || `Product ${index + 1}`}
                      </button>
                    ))}
                  </div>
                )}
                <ResultView
                  role={role}
                  inspection={inspection}
                  counts={counts}
                  selectedCheck={selectedCheck}
                  onSelect={chooseFinding}
                  onReport={saveInspection}
                  reportOpen={reportOpen}
                  onCloseReport={() => setReportOpen(false)}
                  onInspectionUpdated={(updated) => {
                    setInspection(updated);
                    setInspections((prev) => prev.map((item) => item.id === updated.id ? updated : item));
                    fetchHistory();
                  }}
                />
              </>
            )}
            {view === "result" && !inspection && (
              <div className="page-enter" style={{ padding: "40px 20px", textAlign: "center" }}>
                <div className="eyebrow">NO INSPECTION DATA</div>
                <h2 style={{ marginTop: "12px", fontSize: "18px", fontWeight: 700 }}>Inspection result unavailable</h2>
                <p style={{ marginTop: "8px", color: "var(--ink-soft)", fontSize: "13px" }}>
                  The analysis did not return inspection data. Please go back and try again.
                </p>
                <button className="button primary" style={{ marginTop: "16px" }} onClick={() => { setView("scan"); setPhase("image"); }}>
                  Back to scan
                </button>
              </div>
            )}
            {view === "history" && (
              <HistoryView
                items={savedInspections}
                isLoading={isLoadingHistory}
                onStartInspection={startInspection}
                filterRule={dashboardFilterRule}
                filterDate={dashboardFilterDate}
                onClearFilter={() => { setDashboardFilterRule(null); setDashboardFilterDate(null); }}
                onOpen={(item) => {
                  openInspectionResult(item);
                }}
                role={isAdmin ? "admin" : "officer"}
                onClearHistory={purgeArchive}
                onDelete={deleteInspection}
              />
            )}
            {view === "rules" && <RulesView role={isAdmin ? "admin" : "officer"} onSwitchRole={() => {}} />}
            {view === "settings" && <SettingsView userName={user.name} username={user.username} />}
          </ErrorBoundary>
        </div>
      </section>
    </main>
  );
}
