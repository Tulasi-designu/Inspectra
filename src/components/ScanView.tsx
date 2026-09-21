"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  CloudUpload,
  Image as ImageIcon,
  Info,
  Lock,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
  AlertTriangle,
  RefreshCw,
  FlipHorizontal,
  FileText,
  RotateCw,
  SwitchCamera,
  Plus,
  Trash2,
  Eye,
  Radio,
  RadioOff,
  BarChart3,
} from "lucide-react";
import type { AnalysisPhase, Inspection, EvidenceImage, DeclarationField } from "@/domain/inspection";
import { analyzeFrame, type FrameAnalysisResult } from "@/services/frame-analysis";
import { compressAndDownscaleImage } from "@/services/image-compression";
import type { UserRole } from "@/context/RoleContext";
import { LiveCameraEngine } from "@/services/live-camera-engine";
import type { LiveDetectionState, DetectionResult } from "@/services/live-inference";
import { emptyDetectionState } from "@/services/live-inference";

const phaseCopy: Record<AnalysisPhase, { label: string; detail: string }> = {
  image: { label: "Image normalization", detail: "Validating multi-frame package evidence" },
  text: { label: "YOLO region detection", detail: "Locating package & statutory declaration clusters" },
  declarations: { label: "Multi-pass regional OCR", detail: "Recognizing & normalizing declaration values" },
  rules: { label: "Statutory compliance", detail: "Evaluating Indian Legal Metrology Rules (2011)" },
  complete: { label: "Inspection ready", detail: "Evidence-backed compliance result assembled" },
};
const phaseOrder: AnalysisPhase[] = ["image", "text", "declarations", "rules", "complete"];

function cleanErrorMessage(msg: string | null): string {
  if (!msg) return "";
  if (
    msg.includes("prisma.inspectionRecord.upsert") ||
    msg.includes("foreign key") ||
    msg.includes("Foreign key constraint")
  ) {
    return "Inspection record database link has been refreshed. Please click 'Retry Analysis' to proceed.";
  }
  if (msg.includes("EXTRACTION_TIMEOUT") || msg.includes("timed out")) {
    return "Analysis timed out after 30 seconds. Click 'Retry Analysis' to evaluate the package again.";
  }
  const firstLine = msg.split("\n")[0];
  return firstLine.replace(/\/Users\/[^\s]+/g, "").replace(/at async [^\s]+/g, "").trim() || msg;
}

export function ScanView({
  role = "officer",
  inspection,
  phase,
  fileName,
  onUpload,
  onFiles,
  onAnalyze,
  inputRef,
  errorMsg,
  onDismissError,
  elapsed = 0,
  isTimeout = false,
  onRetry,
  activeFiles = [],
  onUpdateFiles,
  isAnalyzing: isAnalyzingProp,
  recentInspections = [],
  onOpenInspection,
}: {
  role?: UserRole;
  inspection: Inspection | null;
  phase: AnalysisPhase;
  fileName: string;
  onUpload: () => void;
  onFiles: (files: File[], append?: boolean) => void;
  onAnalyze: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  errorMsg: string | null;
  onDismissError?: () => void;
  elapsed?: number;
  isTimeout?: boolean;
  onRetry?: () => void;
  activeFiles?: File[];
  onUpdateFiles?: (files: File[]) => void;
  isAnalyzing?: boolean;
  recentInspections?: Inspection[];
  onOpenInspection?: (inspection: Inspection) => void;
}) {
  const isAnalyzing = isAnalyzingProp !== undefined ? isAnalyzingProp : phase !== "image";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  // Camera MUST NOT be mirrored by default so packaging text reads left-to-right
  const [isMirrored, setIsMirrored] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [sessionCapturedCount, setSessionCapturedCount] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Live detection state
  const [liveDetectEnabled, setLiveDetectEnabled] = useState(false);
  const [liveDetectionState, setLiveDetectionState] = useState<LiveDetectionState>(emptyDetectionState());
  const [liveDetection, setLiveDetection] = useState<DetectionResult | null>(null);
  const [liveInferenceMs, setLiveInferenceMs] = useState(0);
  const liveEngineRef = useRef<LiveCameraEngine | null>(null);
  const liveOverlayRef = useRef<HTMLCanvasElement>(null);
  const liveOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const liveDisplayRef = useRef<HTMLDivElement>(null);

  const isMirroredRef = useRef(isMirrored);
  isMirroredRef.current = isMirrored;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  // Tier 0 Classical CV Frame Diagnostics State (100% Client-Side, 0ms latency)
  const [tier0Result, setTier0Result] = useState<FrameAnalysisResult | null>(null);

  // Server-side package-presence confirmation (same gate as the pipeline).
  // READY is shown only after the backend confirms a package in-frame.
  const [serverGate, setServerGate] = useState<{
    state: "LOOKING" | "PACKAGE_NOT_DETECTED" | "PACKAGE_DETECTED" | "CAPTURE_READY" | "QUALITY_INSUFFICIENT";
    tip: string;
  } | null>(null);

  // Live detection effect
  useEffect(() => {
    if (!liveDetectEnabled || !liveEngineRef.current) return;
    const engine = liveEngineRef.current;
    engine.setCameraTransform(rotation, isMirrored);
    if (liveDisplayRef.current) {
      engine.setDisplayDimensions(liveDisplayRef.current.offsetWidth, liveDisplayRef.current.offsetHeight);
    }
  }, [rotation, isMirrored, liveDetectEnabled]);

  // Update overlay when detection changes
  useEffect(() => {
    if (!liveEngineRef.current || !liveOverlayRef.current) return;
    liveEngineRef.current.renderOverlay(liveDetectionState, liveDetection);
  }, [liveDetectionState, liveDetection]);

  useEffect(() => {
    if (!cameraOpen && videoRef.current) {
      if (liveEngineRef.current) {
        liveEngineRef.current.stop();
        liveEngineRef.current = null;
      }
      setLiveDetectEnabled(false);
    }
  }, [cameraOpen]);

  // Live detection engine lifecycle: auto-starts the moment the camera opens
  // (automatic object detection + extraction — no manual toggle needed). The
  // engine's smart dispatch only extracts when Tier-0 quality signals and the
  // server package gate both say the frame is readable, so this is cheap when
  // the officer is still framing the product.
  useEffect(() => {
    if (!cameraOpen || !liveDetectEnabled) return;
    const video = videoRef.current;
    const overlayCanvas = liveOverlayRef.current;
    if (!video || !overlayCanvas) return;

    const offscreenCanvas = liveOffscreenRef.current || document.createElement("canvas");
    liveOffscreenRef.current = offscreenCanvas;

    const engine = new LiveCameraEngine();
    const handleDetection = (state: LiveDetectionState, detection: DetectionResult | null) => {
      setLiveDetectionState(state);
      setLiveDetection(detection);
      if (detection) {
        setLiveInferenceMs(detection.inferenceMs);
      }
    };
    const handleStateChange = (_running: boolean) => {
      // Engine state changed
    };
    engine.setCallbacks(handleDetection, handleStateChange);
    engine.setCameraTransform(rotationRef.current, isMirroredRef.current);
    engine.setDevicePixelRatio(window.devicePixelRatio || 1);
    const displayEl = liveDisplayRef.current;
    if (displayEl) {
      engine.setDisplayDimensions(displayEl.offsetWidth, displayEl.offsetHeight);
    }
    engine.start(video, overlayCanvas, offscreenCanvas);
    liveEngineRef.current = engine;

    return () => {
      engine.stop();
      if (liveEngineRef.current === engine) {
        liveEngineRef.current = null;
      }
    };
  }, [cameraOpen, liveDetectEnabled]);

  // Feed the latest Tier-0 quality and server package-gate state into the
  // engine's dispatch policy (smart dispatch: no OCR while blurry/no package).
  useEffect(() => {
    if (!liveEngineRef.current) return;
    liveEngineRef.current.setFrameQuality(tier0Result);
  }, [tier0Result]);

  useEffect(() => {
    if (!liveEngineRef.current) return;
    liveEngineRef.current.setGateStatus(serverGate?.state ?? null);
  }, [serverGate]);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (droppedFiles.length > 0) {
        onFiles(droppedFiles, true);
      }
    }
  }

  async function flipStagedImage(index: number) {
    if (!activeFiles || !activeFiles[index] || !onUpdateFiles) return;
    try {
      const file = activeFiles[index];
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      URL.revokeObjectURL(url);

      const flippedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), file.type || "image/jpeg", 0.92);
      });

      if (flippedBlob) {
        const flippedFile = new File([flippedBlob], file.name, {
          type: file.type || "image/jpeg",
          lastModified: Date.now(),
        });
        const updated = [...activeFiles];
        updated[index] = flippedFile;
        onUpdateFiles(updated);
      }
    } catch (err) {
      console.error("Failed to flip staged image:", err);
    }
  }

  function removeStagedImage(index: number) {
    if (!activeFiles || !onUpdateFiles) return;
    const updated = activeFiles.filter((_, i) => i !== index);
    onUpdateFiles(updated);
    if (selectedImageIndex >= updated.length && updated.length > 0) {
      setSelectedImageIndex(updated.length - 1);
    }
  }

  const gateInFlightRef = useRef(false);
  const gateCheck = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || gateInFlightRef.current) return;
    gateInFlightRef.current = true;
    try {
      const canvas = document.createElement("canvas");
      const scale = 320 / video.videoWidth;
      canvas.width = 320;
      canvas.height = Math.max(180, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const res = await fetch("/api/scan/live-guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        const state = data.packageDetected
          ? data.packageConfidence >= 0.6 ? "CAPTURE_READY" : "PACKAGE_DETECTED"
          : data.state === "QUALITY_INSUFFICIENT" ? "QUALITY_INSUFFICIENT" : "PACKAGE_NOT_DETECTED";
        setServerGate({ state, tip: data.tip || "Looking for package..." });
      }
    } catch {
      // Guidance is advisory — Tier-0 HUD keeps working offline.
    } finally {
      gateInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!cameraOpen) {
      setServerGate(null);
      return;
    }
    setServerGate({ state: "LOOKING", tip: "Looking for package..." });
    const timer = setInterval(gateCheck, 2500);
    return () => clearInterval(timer);
  }, [cameraOpen]);

  const previousGrayRef = useRef<Uint8Array | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);

  const images = inspection?.images || [];
  const currentImage: EvidenceImage | undefined = images[selectedImageIndex] || images[0];

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  // Adjust selected index when images change
  useEffect(() => {
    if (images.length > 0 && selectedImageIndex >= images.length) {
      setSelectedImageIndex(images.length - 1);
    }
  }, [images.length, selectedImageIndex]);

  // Real-time client-side classical CV frame sampling loop via requestAnimationFrame (~180ms throttle)
  useEffect(() => {
    if (!cameraOpen) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      previousGrayRef.current = null;
      setTier0Result(null);
      return;
    }

    let isMounted = true;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement("canvas");
      offscreenCanvasRef.current.width = 320;
      offscreenCanvasRef.current.height = 240;
    }
    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const processFrame = (timestamp: number) => {
      if (!isMounted) return;

      if (timestamp - lastSampleTimeRef.current >= 180) {
        lastSampleTimeRef.current = timestamp;
        const video = videoRef.current;

        if (video && video.readyState >= 2 && video.videoWidth > 0 && ctx) {
          const curRot = rotationRef.current;
          const curMirror = isMirroredRef.current;
          const isRot90or270 = curRot === 90 || curRot === 270;
          const baseW = isRot90or270 ? video.videoHeight : video.videoWidth;
          const baseH = isRot90or270 ? video.videoWidth : video.videoHeight;
          const targetWidth = 320;
          const targetHeight = Math.round((baseH / baseW) * targetWidth) || 240;
          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }

          ctx.save();
          ctx.translate(targetWidth / 2, targetHeight / 2);
          ctx.rotate((curRot * Math.PI) / 180);
          if (curMirror) {
            ctx.scale(-1, 1);
          }
          const drawW = isRot90or270 ? targetHeight : targetWidth;
          const drawH = isRot90or270 ? targetWidth : targetHeight;
          ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
          const { result, gray } = analyzeFrame(imageData, previousGrayRef.current);
          previousGrayRef.current = gray;

          if (isMounted) {
            setTier0Result(result);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(processFrame);
    };

    rafIdRef.current = requestAnimationFrame(processFrame);

    return () => {
      isMounted = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [cameraOpen]);

  async function openCamera(preferredMode?: "environment" | "user") {
    const targetMode = preferredMode ?? facingMode;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is unavailable in this browser.");
      return;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          }),
          new Promise<MediaStream>((_, reject) =>
            setTimeout(() => reject(new Error("Camera permission request timed out.")), 8000)
          ),
        ]);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setFacingMode(targetMode);
      // Strictly unmirrored by default so packaging text reads left-to-right naturally
      setIsMirrored(false);
      setCameraOpen(true);
      // Automatic object detection + extraction starts with the camera.
      setLiveDetectEnabled(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (error) {
      setCameraError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission was denied."
          : error instanceof Error
          ? error.message
          : "Camera could not be opened."
      );
    }
  }

  function toggleFacingMode() {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    setIsMirrored(false);
    openCamera(nextMode);
  }

  function toggleMirror() {
    setIsMirrored((prev) => !prev);
  }

  function cycleRotation() {
    setRotation((prev) => ((prev + 90) % 360) as 0 | 90 | 180 | 270);
  }

  function closeCamera() {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (liveEngineRef.current) {
      liveEngineRef.current.stop();
      liveEngineRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setLiveDetectEnabled(false);
    setTier0Result(null);
    previousGrayRef.current = null;
    setSessionCapturedCount(0);
  }

  function toggleLiveDetect() {
    if (liveDetectEnabled) {
      // Engine stop is owned by the lifecycle effect above.
      setLiveDetectEnabled(false);
      setLiveDetectionState(emptyDetectionState());
      setLiveDetection(null);
      return;
    }
    setLiveDetectEnabled(true);
  }

  function captureFrame(closeAfter = false) {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setCameraError("Camera frame is not ready yet.");
      return;
    }

    const curRot = rotationRef.current;
    const isRot90or270 = curRot === 90 || curRot === 270;
    const targetWidth = isRot90or270 ? video.videoHeight : video.videoWidth;
    const targetHeight = isRot90or270 ? video.videoWidth : video.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Canvas context unavailable.");
      return;
    }

    // Evidence pixels are always unmirrored. Preview mirroring is a display-only
    // aid and must never become part of the statutory evidence record.
    ctx.save();
    ctx.translate(targetWidth / 2, targetHeight / 2);
    ctx.rotate((curRot * Math.PI) / 180);
    ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
    ctx.restore();

    canvas.toBlob(async (blob) => {
      if (blob) {
        try {
          const timestamp = Date.now();
          const count = sessionCapturedCount + 1;
          const compressedFile = await compressAndDownscaleImage(
            blob,
            `evidence-photo-${count}-${timestamp}.jpg`,
            1600,
            0.85
          );
          onFiles([compressedFile], true);
          setSessionCapturedCount(count);
          if (closeAfter) {
            closeCamera();
          }
        } catch (err) {
          console.error("Failed to compress captured frame, using raw file fallback:", err);
          const rawFile = new File([blob], `evidence-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
          onFiles([rawFile], true);
          if (closeAfter) {
            closeCamera();
          }
        }
      } else {
        setCameraError("Failed to create image from camera frame.");
      }
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="inspectra-scan-page">
      <style jsx global>{`
        :root{
          --inspectra-navy:#0d224b;
          --inspectra-blue:#3e54e9;
          --inspectra-purple:#7144ec;
          --inspectra-muted:#7183a5;
          --inspectra-border:#dce6f3;
          --inspectra-bg:#f3f7ff;
        }

        /* Page background */
        .scan-layout,
        .scan-layout *{
          box-sizing:border-box;
        }

        .scan-layout{
          display:grid !important;
          grid-template-columns:minmax(0,1fr) 360px;
          grid-template-rows:auto auto;
          gap:16px 20px;
          align-items:start;
          margin-top:16px;
        }

        /* Main evidence card */
        .capture-panel{
          grid-column:1;
          grid-row:1;
          background:#fff !important;
          border:1px solid var(--inspectra-border) !important;
          border-radius:15px !important;
          padding:20px 28px !important;
          box-shadow:0 8px 28px rgba(33,67,125,.07) !important;
          min-width:0;
        }

        .capture-head{
          display:flex !important;
          justify-content:space-between !important;
          align-items:flex-start !important;
          margin-bottom:12px !important;
        }

        .capture-head h2{
          margin:6px 0 0 !important;
          color:var(--inspectra-navy) !important;
          font-size:21px !important;
          letter-spacing:-.35px !important;
        }

        .eyebrow{
          display:inline-flex !important;
          align-items:center !important;
          padding:4px 9px !important;
          border-radius:8px !important;
          background:#edf2ff !important;
          color:#4662df !important;
          font-size:9px !important;
          font-weight:800 !important;
          letter-spacing:.45px !important;
        }

        .quality-badge{
          margin-top:12px !important;
          display:inline-flex !important;
          align-items:center !important;
          gap:6px !important;
          padding:8px 12px !important;
          border-radius:18px !important;
          background:#def8ed !important;
          color:#07885d !important;
          font-size:9px !important;
          font-weight:700 !important;
          white-space:nowrap !important;
        }

        /* Reference-style upload rectangle */
        .scan-stage{
          position:relative !important;
          min-height:260px !important;
          height:260px !important;
          overflow:hidden !important;
          border:2px dashed #b8caf5 !important;
          border-radius:12px !important;
          background:
            radial-gradient(480px 190px at 50% 38%,rgba(224,236,255,.46),transparent 70%),
            linear-gradient(180deg,#fbfdff,#f7faff) !important;
          box-shadow:none !important;
          display:flex !important;
          align-items:center !important;
          justify-content:center !important;
        }

        .staged-evidence-image{
          position:absolute !important;
          top:-2% !important;
          left:-2% !important;
          z-index:1 !important;
          width:104% !important;
          height:104% !important;
          object-fit:cover !important;
          object-position:center !important;
          background:#f7faff !important;
          cursor:zoom-in !important;
        }

        .evidence-lightbox{
          position:fixed !important;
          inset:0 !important;
          z-index:1000 !important;
          display:flex !important;
          align-items:center !important;
          justify-content:center !important;
          padding:32px !important;
          background:rgba(8,18,40,.88) !important;
        }

        .evidence-lightbox-image{
          max-width:92vw !important;
          max-height:90vh !important;
          object-fit:contain !important;
          border-radius:10px !important;
          box-shadow:0 18px 55px rgba(0,0,0,.4) !important;
        }

        .evidence-lightbox-close{
          position:absolute !important;
          top:18px !important;
          right:22px !important;
          width:38px !important;
          height:38px !important;
          display:grid !important;
          place-items:center !important;
          border:0 !important;
          border-radius:50% !important;
          background:#fff !important;
          color:#13295b !important;
          cursor:pointer !important;
        }

        .scan-stage.drag-over{
          border-color:#536cf0 !important;
          background:#f2f6ff !important;
        }

        .drop-prompt{
          display:flex !important;
          flex-direction:column !important;
          align-items:center !important;
          justify-content:center !important;
          text-align:center !important;
          position:relative !important;
          z-index:2 !important;
        }

        .drop-icon{
          width:78px !important;
          height:78px !important;
          border-radius:50% !important;
          display:grid !important;
          place-items:center !important;
          background:#ece9ff !important;
          color:#4c40e6 !important;
          margin-bottom:10px !important;
          box-shadow:0 7px 20px rgba(83,65,225,.08) !important;
          cursor:pointer !important;
          transition:transform .18s ease, box-shadow .18s ease !important;
        }

        .drop-icon:hover,
        .drop-icon:focus-visible{
          transform:translateY(-2px) !important;
          box-shadow:0 10px 24px rgba(83,65,225,.18) !important;
        }

        .drop-prompt b{
          color:#13295c !important;
          font-size:16px !important;
          line-height:1.25 !important;
        }

        .drop-prompt > span{
          color:#7385a7 !important;
          font-size:11px !important;
          margin-top:6px !important;
        }

        .capture-actions{
          justify-content:center !important;
          margin-top:16px !important;
          flex-wrap:nowrap !important;
          width:100% !important;
        }

        .capture-actions .button{
          min-height:46px !important;
          flex:1 1 0 !important;
          min-width:0 !important;
          padding:0 18px !important;
          border-radius:10px !important;
          font-size:11px !important;
          font-weight:700 !important;
          white-space:nowrap !important;
          border:1px solid #8098f0 !important;
          background:#fff !important;
          color:#234fd2 !important;
          box-shadow:0 5px 14px rgba(37,67,137,.05) !important;
        }

        .capture-actions .button.primary{
          border:0 !important;
          color:#fff !important;
          background:linear-gradient(100deg,#4141ed,#7042eb) !important;
          box-shadow:0 9px 20px rgba(74,65,224,.22) !important;
        }

        /* Soft leaf decorations in both lower corners */
        .scan-stage::before,
        .scan-stage::after{
          content:"";
          position:absolute;
          bottom:-14px;
          width:112px;
          height:105px;
          pointer-events:none;
          opacity:.72;
          z-index:1;
          background:
            radial-gradient(ellipse at 18% 76%,#a4e2cd 0 12%,transparent 13%),
            radial-gradient(ellipse at 42% 62%,#80cdb2 0 13%,transparent 14%),
            radial-gradient(ellipse at 65% 80%,#b2e9d7 0 13%,transparent 14%);
          clip-path:polygon(0 100%,10% 70%,22% 83%,31% 47%,43% 65%,56% 35%,69% 67%,84% 51%,100% 100%);
        }

        .scan-stage::before{left:-5px;transform:rotate(-2deg)}
        .scan-stage::after{right:-5px;transform:scaleX(-1) rotate(-2deg)}

        /* Gallery */
        .capture-panel > div[style*="marginTop"]{
          color:var(--inspectra-muted);
        }

        /* Feature strip */
        .scanner-feature-strip{
          grid-column:1;
          grid-row:2;
          margin-top:0 !important;
          background:#fff !important;
          border:1px solid var(--inspectra-border) !important;
          border-radius:15px !important;
          padding:16px 10px !important;
          box-shadow:0 7px 25px rgba(33,67,125,.05) !important;
          display:grid !important;
          grid-template-columns:repeat(4,1fr) !important;
          gap:0 !important;
        }

        .scanner-feature{
          min-width:0 !important;
          padding:3px 16px !important;
          border-right:1px solid #e7edf5 !important;
          display:flex !important;
          flex-direction:column !important;
          align-items:center !important;
          text-align:center !important;
          gap:7px !important;
        }

        .scanner-feature:last-child{border-right:0 !important}

        .scanner-feature-icon{
          width:43px !important;
          height:43px !important;
          flex:0 0 43px !important;
          border-radius:50% !important;
          display:grid !important;
          place-items:center !important;
        }

        .scanner-feature-icon.purple{background:#ece9ff !important;color:#5142e7 !important}
        .scanner-feature-icon.green{background:#e1f8f0 !important;color:#16a67a !important}
        .scanner-feature-icon.orange{background:#fff0e5 !important;color:#f2772f !important}
        .scanner-feature-icon.blue{background:#e6f2ff !important;color:#397be7 !important}

        .scanner-feature strong{
          display:block !important;
          color:#13295b !important;
          font-size:10px !important;
          line-height:1.25 !important;
          margin-top:0 !important;
        }

        .scanner-feature span{
          display:block !important;
          color:#7789aa !important;
          font-size:8px !important;
          line-height:1.45 !important;
          margin-top:0 !important;
          max-width:150px !important;
        }

        /* Right pipeline panel */
        .analysis-panel{
          grid-column:2 !important;
          grid-row:1 / span 2 !important;
          background:#fff !important;
          border:1px solid var(--inspectra-border) !important;
          border-radius:15px !important;
          padding:20px 22px !important;
          box-shadow:0 8px 28px rgba(33,67,125,.07) !important;
          min-width:0 !important;
        }

        .analysis-panel .panel-title{
          display:grid !important;
          grid-template-columns:39px minmax(0,1fr) !important;
          align-items:center !important;
          column-gap:11px !important;
          margin-bottom:13px !important;
        }

        .analysis-panel .panel-title::before{
          display:none !important;
        }

        .analysis-panel-icon{
          grid-column:1 !important;
          width:39px !important;
          height:39px !important;
          display:grid !important;
          place-items:center !important;
          border-radius:10px !important;
          color:#fff !important;
          background:linear-gradient(135deg,#4c38e9,#4e55e8) !important;
          box-shadow:0 7px 15px rgba(76,56,233,.16) !important;
        }

        .analysis-panel .panel-title > div{
          grid-column:2 !important;
          min-width:0 !important;
        }

        .analysis-panel .eyebrow{
          background:transparent !important;
          padding:0 !important;
          color:#7544eb !important;
          font-size:9px !important;
          letter-spacing:.55px !important;
        }

        .analysis-panel h2{
          color:#14295b !important;
          font-size:17px !important;
          margin:4px 0 0 !important;
        }

        .pipeline-steps-grid{
          display:flex !important;
          flex-direction:column !important;
          gap:6px !important;
        }

        .pipeline-step-card{
          min-height:65px !important;
          border:1px solid #dce5f2 !important;
          border-radius:10px !important;
          padding:7px 10px !important;
          display:flex !important;
          flex-direction:row !important;
          align-items:center !important;
          gap:10px !important;
          text-align:left !important;
          background:linear-gradient(100deg,#fff,#fafdff) !important;
          transition:.18s !important;
        }

        .pipeline-step-card:hover{
          transform:translateX(2px);
          border-color:#a5b4ef !important;
        }

        .pipeline-step-card.active{
          border-color:#8b8cf8 !important;
          box-shadow:inset 0 0 0 1px rgba(92,80,231,.08) !important;
          background:#fbfbff !important;
        }

        .pipeline-step-card.done{
          background:#fbfffd !important;
          border-color:#d8eee5 !important;
        }

        .pipeline-step-header{
          display:flex !important;
          align-items:center !important;
          justify-content:flex-start !important;
          flex:0 0 auto !important;
          width:29px !important;
        }

        .pipeline-step-icon{
          width:30px !important;
          height:30px !important;
          flex:0 0 30px !important;
          display:grid !important;
          place-items:center !important;
          border-radius:50% !important;
          background:#e9efff !important;
          color:#183d8c !important;
        }

        .pipeline-step-card.done .pipeline-step-icon{
          background:#e2f8ef !important;
          color:#07966a !important;
        }

        .pipeline-step-badge{
          width:29px !important;
          height:29px !important;
          border-radius:50% !important;
          display:grid !important;
          place-items:center !important;
          background:#e8edf6 !important;
          color:#183164 !important;
          font-size:10px !important;
          font-weight:800 !important;
        }

        .pipeline-step-card.active .pipeline-step-badge{
          background:#4262e8 !important;
          color:#fff !important;
        }

        .pipeline-step-card.done .pipeline-step-badge{
          background:#dcf7ec !important;
          color:#0b9b68 !important;
        }

        .pipeline-step-live-dot{
          display:none !important;
        }

        .pipeline-step-content{
          flex:1 !important;
          min-width:0 !important;
          text-align:left !important;
        }

        .pipeline-step-title{
          display:block !important;
          color:#13295b !important;
          font-size:10.5px !important;
          line-height:1.25 !important;
        }

        .pipeline-step-desc{
          display:block !important;
          color:#7a8baa !important;
          font-size:8px !important;
          line-height:1.4 !important;
          margin-top:4px !important;
        }

        .analysis-panel .button.primary{
          width:100% !important;
          min-height:43px !important;
          border:0 !important;
          border-radius:10px !important;
          opacity:1 !important;
          color:#fff !important;
          background:linear-gradient(95deg,#2529d8,#4c29d9 58%,#277edb) !important;
          box-shadow:0 9px 18px rgba(44,45,190,.25) !important;
        }

        .recent-analyses{
          margin-top:28px !important;
          padding:14px 14px 8px !important;
          border:1px solid var(--inspectra-border) !important;
          border-radius:12px !important;
          background:#fff !important;
        }

        .recent-analyses-head{
          display:flex !important;
          align-items:center !important;
          justify-content:space-between !important;
          margin-bottom:6px !important;
        }

        .recent-analyses-title{
          color:#14295b !important;
          font-size:10px !important;
          font-weight:800 !important;
        }

        .recent-analyses-link{
          border:0 !important;
          padding:0 !important;
          background:transparent !important;
          color:#4058e8 !important;
          font-size:9px !important;
          font-weight:800 !important;
          cursor:pointer !important;
        }

        .recent-analysis-row{
          width:100% !important;
          display:flex !important;
          align-items:center !important;
          gap:9px !important;
          padding:8px 0 !important;
          border:0 !important;
          border-top:1px solid #edf1f7 !important;
          background:transparent !important;
          text-align:left !important;
          cursor:pointer !important;
        }

        .recent-analysis-icon{
          width:25px !important;
          height:25px !important;
          flex:0 0 25px !important;
          display:grid !important;
          place-items:center !important;
          border-radius:50% !important;
          background:#edf2ff !important;
          color:#1d3c8f !important;
        }

        .recent-analysis-copy{
          min-width:0 !important;
          flex:1 !important;
        }

        .recent-analysis-name{
          display:block !important;
          overflow:hidden !important;
          color:#182c5b !important;
          font-size:9px !important;
          font-weight:700 !important;
          text-overflow:ellipsis !important;
          white-space:nowrap !important;
        }

        .recent-analysis-date{
          display:block !important;
          margin-top:2px !important;
          color:#7d8eab !important;
          font-size:8px !important;
        }

        .recent-analysis-status{
          padding:4px 7px !important;
          border-radius:12px !important;
          background:#d9f7eb !important;
          color:#07966a !important;
          font-size:8px !important;
          font-weight:800 !important;
          white-space:nowrap !important;
        }

        /* Top hero */
        .hero{
          height:148px !important;
          border-radius:14px !important;
          position:relative !important;
          overflow:hidden !important;
          border:1px solid #dce6f5 !important;
          background:
            radial-gradient(300px 140px at 87% 55%,rgba(157,221,255,.46),transparent 70%),
            radial-gradient(300px 170px at 60% 50%,rgba(226,216,255,.52),transparent 75%),
            linear-gradient(105deg,#effbff 0%,#eef4ff 52%,#eaf2ff 100%) !important;
          box-shadow:0 7px 25px rgba(43,75,130,.07) !important;
          padding:24px 30px !important;
        }

        .hero .welcome{
          font-size:10px !important;
          letter-spacing:2px !important;
          font-weight:800 !important;
          color:#6e48ed !important;
          margin-bottom:6px !important;
        }

        .hero h1{
          font-size:28px !important;
          line-height:1.1 !important;
          margin:0 !important;
          color:#11285a !important;
          letter-spacing:-.7px !important;
        }

        .hero p{
          font-size:12px !important;
          line-height:1.55 !important;
          color:#5f759f !important;
          margin:8px 0 0 !important;
          max-width:590px !important;
        }

        .hero-art{
          position:absolute !important;
          right:22px !important;
          top:0 !important;
          width:365px !important;
          height:148px !important;
        }

        .hero-float{
          width:34px !important;
          height:34px !important;
          border-radius:10px !important;
          display:grid !important;
          place-items:center !important;
          color:#fff !important;
          background:linear-gradient(135deg,#4059ee,#6d45e9) !important;
          box-shadow:0 8px 18px rgba(62,70,211,.25) !important;
        }

        .hero-package{
          width:72px !important;
          height:63px !important;
          top:48px !important;
          right:83px !important;
          border-radius:4px !important;
          background:linear-gradient(145deg,#f2bd77,#c87b3d) !important;
          box-shadow:0 14px 22px rgba(94,67,37,.18) !important;
        }

        .slogan{
          color:#153c98 !important;
          font-size:18px !important;
        }

        /* Remove old heading spacing because the screenshot uses the hero as the page title */
        .page-heading{
          min-height:0 !important;
          margin:0 !important;
          padding:0 !important;
        }

        /* Notice */
        .inspection-notice-banner{
          margin-top:14px !important;
          border-radius:11px !important;
          border:1px solid #f4d59b !important;
          background:#fffaf0 !important;
        }

        /* Responsive */
        @media(max-width:1180px){
          .scan-layout{
            grid-template-columns:minmax(0,1fr) 360px;
          }
        }

        @media(max-width:980px){
          .scan-layout{
            grid-template-columns:1fr;
            grid-template-rows:auto;
          }
          .capture-panel,.scanner-feature-strip,.analysis-panel{
            grid-column:1;
            grid-row:auto;
          }
          .analysis-panel{order:3}
          .scanner-feature-strip{order:2}
        }

        @media(max-width:700px){
          .hero{height:auto !important;min-height:145px !important}
          .hero-art{display:none !important}
          .capture-panel{padding:15px !important}
          .scan-stage{height:300px !important}
          .scanner-feature-strip{grid-template-columns:1fr 1fr !important}
          .scanner-feature{padding:10px 12px !important}
          .scanner-feature:nth-child(2){border-right:0 !important}
          .scanner-feature:nth-child(-n+2){border-bottom:1px solid #e7edf5 !important}
        }

        @media(max-width:480px){
          .scanner-feature-strip{grid-template-columns:1fr !important}
          .scanner-feature{border-right:0 !important;border-bottom:1px solid #e7edf5 !important}
          .scanner-feature:last-child{border-bottom:0 !important}
          .capture-head{display:block !important}
          .quality-badge{margin-top:9px !important}
          .capture-actions{flex-direction:row !important;width:100% !important;gap:8px !important}
          .capture-actions .button{width:auto !important;padding-left:8px !important;padding-right:8px !important;font-size:10px !important}
        }
      `}</style>

      <section className="hero">
  <div className="welcome">WELCOME TO</div>

  <h1>Evidence Capture Console</h1>

  <p>
    Capture multi-angle package evidence (Front, Back, MR/Date panel, Ingredients)
    <br />
    for statutory evaluation.
  </p>

  <div className="hero-art" aria-hidden="true">
    <div className="slogan">
      Safer Foods
      <br />
      Healthier Tomorrow
      <div className="slogan-line" />
    </div>

    <div className="hero-float hf1">
      <ImageIcon size={16} />
    </div>

    <div className="hero-float hf2">
      <ScanLine size={16} />
    </div>

    <div className="hero-float hf3">
      <ShieldCheck size={16} />
    </div>

    <div className="hero-float hf4">
      <ScanLine size={16} />
    </div>

    <div className="hero-package">
      <div className="barcode" />
    </div>

    <svg className="hero-leaf" viewBox="0 0 140 115">
      <path d="M15 112 C48 83 70 48 88 5 C55 18 36 47 43 70 C65 66 87 47 88 5Z" />
      <path d="M50 112 C73 91 105 80 134 83 C118 105 85 116 50 112Z" />
    </svg>
  </div>
</section>
      {/* <div className="eyebrow">LEGAL METROLOGY INSPECTION / {inspection?.id || "DRAFT"}</div> */}
      <div className="page-heading">
        <div>
          {/* <h1>Evidence Capture Console</h1> */}
          {/* <p>Capture multi-angle package evidence (Front, Back, MRP/Date panel, Ingredients) for statutory evaluation.</p> */}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="capture-badge">
            <span className="status-dot" style={{ backgroundColor: images.length > 0 ? "#10b981" : "#f59e0b" }} />
            {images.length} Evidence Photo{images.length === 1 ? "" : "s"} Staged
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="inspection-notice-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <div className="inspection-notice-icon">
              <AlertTriangle size={18} />
            </div>
            <div className="inspection-notice-body">
              <div className="inspection-notice-title">Pipeline Notice</div>
              <div className="inspection-notice-text">{cleanErrorMessage(errorMsg)}</div>
            </div>
          </div>
          <div className="inspection-notice-actions">
            <button
              type="button"
              className="button primary"
              style={{ fontSize: "13px", padding: "6px 14px", whiteSpace: "nowrap" }}
              onClick={onRetry || onAnalyze}
            >
              <RefreshCw size={14} /> Retry Analysis
            </button>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                title="Dismiss notice"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#92400e",
                  cursor: "pointer",
                  padding: "6px",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "4px",
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="scan-layout">
        <section className="capture-panel">
          <div className="capture-head">
            <div>
              <span className="eyebrow">
                EVIDENCE FRAME {String(selectedImageIndex + 1).padStart(2, "0")} / {String(Math.max(1, images.length)).padStart(2, "0")}
              </span>
              <h2>{currentImage?.side ? `${currentImage.side.toUpperCase()} VIEW` : "PRIMARY PACKAGE FACE"}</h2>
            </div>
            {images.length > 0 && (
              <span className="quality-badge">
                <Check size={13} /> {currentImage?.width} × {currentImage?.height}px
              </span>
            )}
          </div>

          {/* Main Inspection Viewport */}
          <div
            className={`scan-stage ${images.length ? "has-image" : ""} ${isDragging ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {currentImage && (
              <img
                className="staged-evidence-image"
                src={currentImage.uri}
                alt={`Evidence frame ${selectedImageIndex + 1}`}
                role="button"
                tabIndex={0}
                onClick={() => setIsImagePreviewOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIsImagePreviewOpen(true);
                  }
                }}
              />
            )}

            {!images.length && (
              <div className="drop-prompt">
                <div
                  className="drop-icon"
                  role="button"
                  tabIndex={0}
                  aria-label="Choose package image files"
                  onClick={onUpload}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onUpload();
                    }
                  }}
                >
                  <CloudUpload size={30} />
                </div>
                <b>Drop food package images here</b>
                <span>Supports JPG, PNG, WEBP (front, back, and declaration sides)</span>
                <div className="capture-actions" style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                  <button className="button secondary" onClick={onUpload}>
                    <Upload size={15} /> Upload image(s)
                  </button>
                  <button className="button primary" onClick={() => openCamera("environment")}>
                    <Camera size={15} /> Launch camera
                  </button>
                </div>
              </div>
            )}

            {!!images.length && (
              <div className="capture-overlay">
                <span>
                  <span className="status-dot" style={{ backgroundColor: "#10b981" }} /> Frame {selectedImageIndex + 1} of {images.length} locked
                </span>
                <div className="capture-overlay-actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {activeFiles && activeFiles[selectedImageIndex] && onUpdateFiles && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => flipStagedImage(selectedImageIndex)}
                      title="Flip photo horizontally to unmirror backward package text"
                      style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <FlipHorizontal size={14} /> Flip / Unmirror
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => openCamera("environment")}
                    style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Camera size={14} /> Add photo
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={onUpload}
                    style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Plus size={14} /> Add file
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Hidden File Input */}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                onFiles([...event.target.files], true);
              }
              event.target.value = "";
            }}
          />

          {/* Multi-Photo Evidence Gallery Strip */}
          {images.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span className="eyebrow" style={{ color: "var(--muted)" }}>
                  STAGED EVIDENCE GALLERY ({images.length} PHOTOS)
                </span>
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>Click a frame to inspect</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: "10px",
                }}
              >
                {images.map((img, idx) => (
                  <div
                    key={img.id || idx}
                    onClick={() => setSelectedImageIndex(idx)}
                    style={{
                      position: "relative",
                      height: "95px",
                      borderRadius: "6px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border: idx === selectedImageIndex ? "2px solid #2563eb" : "1px solid rgba(255,255,255,0.15)",
                      boxShadow: idx === selectedImageIndex ? "0 0 0 2px rgba(37,99,235,0.3)" : "none",
                      backgroundImage: `url(${img.uri})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {activeFiles && activeFiles[idx] && onUpdateFiles && (
                      <div
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          display: "flex",
                          gap: "4px",
                          zIndex: 3,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            flipStagedImage(idx);
                          }}
                          title="Flip photo horizontally (unmirror)"
                          style={{
                            background: "rgba(15, 23, 42, 0.85)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            color: "#fff",
                            width: "22px",
                            height: "22px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <FlipHorizontal size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStagedImage(idx);
                          }}
                          title="Remove photo"
                          style={{
                            background: "rgba(15, 23, 42, 0.85)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            color: "#f87171",
                            width: "22px",
                            height: "22px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "rgba(15, 23, 42, 0.85)",
                        padding: "3px 6px",
                        fontSize: "0.7rem",
                        color: "#fff",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>Photo {idx + 1}</span>
                      <span style={{ textTransform: "capitalize", opacity: 0.8 }}>{img.side || "frame"}</span>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => openCamera("environment")}
                  style={{
                    height: "90px",
                    borderRadius: "6px",
                    border: "2px dashed rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.02)",
                    color: "var(--muted)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  <Camera size={18} />
                  <span>+ Add photo</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Dialog */}
          {cameraOpen && (
            <div className="camera-dialog" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" }}>
              {/* Camera Controls Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#0f172a",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={toggleMirror}
                    style={{
                      fontSize: "12px",
                      padding: "6px 12px",
                      backgroundColor: isMirrored ? "#b45309" : "#15803d",
                      color: "#fff",
                      borderColor: isMirrored ? "#f59e0b" : "#22c55e",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    title="Toggle horizontal mirror"
                  >
                    <FlipHorizontal size={14} />
                    {isMirrored ? "Feed: Mirrored (Inverted)" : "Feed: Normal (Unmirrored)"}
                  </button>

                  <button
                    type="button"
                    className="button secondary"
                    onClick={cycleRotation}
                    style={{
                      fontSize: "12px",
                      padding: "5px 11px",
                      backgroundColor: rotation !== 0 ? "#2563eb" : "rgba(255,255,255,0.1)",
                      color: "#fff",
                      borderColor: rotation !== 0 ? "#3b82f6" : "rgba(255,255,255,0.2)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    <RotateCw size={14} />
                    {rotation}°
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                   <button
                     type="button"
                     className="button secondary"
                     onClick={toggleFacingMode}
                     style={{
                       fontSize: "12px",
                       padding: "5px 11px",
                       backgroundColor: "rgba(255,255,255,0.1)",
                       color: "#fff",
                       borderColor: "rgba(255,255,255,0.2)",
                       display: "inline-flex",
                       alignItems: "center",
                       gap: "6px",
                       cursor: "pointer",
                       fontWeight: 600,
                     }}
                   >
                     <SwitchCamera size={14} />
                     {facingMode === "environment" ? "Rear Camera" : "Front Camera"}
                   </button>

                   <button
                     type="button"
                     className={liveDetectEnabled ? "button secondary" : "button secondary"}
                     onClick={toggleLiveDetect}
                     style={{
                       fontSize: "12px",
                       padding: "5px 11px",
                       backgroundColor: liveDetectEnabled ? "#dc2626" : "rgba(34,197,94,0.3)",
                       color: "#fff",
                       borderColor: liveDetectEnabled ? "#dc2626" : "#22c55e",
                       display: "inline-flex",
                       alignItems: "center",
                       gap: "6px",
                       cursor: "pointer",
                       fontWeight: 600,
                     }}
                   >
                     {liveDetectEnabled ? <RadioOff size={14} /> : <Radio size={14} />}
                     {liveDetectEnabled ? "Stop Live Detect" : "Live Detect"}
                   </button>

                   <button
                     type="button"
                     className="icon-button light"
                     onClick={closeCamera}
                     title="Close camera"
                   >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Verified Non-Mirrored Rear Camera Guarantee Banner */}
              <div
                style={{
                  backgroundColor: isMirrored ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                  border: `1px solid ${isMirrored ? "rgba(245, 158, 11, 0.35)" : "rgba(16, 185, 129, 0.35)"}`,
                  color: isMirrored ? "#fcd34d" : "#34d399",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isMirrored ? <AlertTriangle size={13} /> : <Check size={13} />}
                <span>
                  <b>Orientation:</b>{" "}
                  {isMirrored
                    ? "Mirror mode active (inverted). Click 'Feed: Normal' for readable package text."
                    : "1:1 Unmirrored feed. Package text and labels read naturally left-to-right."}
                </span>
              </div>

                 {/* Video Preview */}
                <div
                  ref={liveDisplayRef}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    borderRadius: "8px",
                    backgroundColor: "#000",
                    minHeight: "280px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      transform: `${isMirrored ? "scaleX(-1) " : ""}${rotation ? `rotate(${rotation}deg)` : ""}`.trim() || "none",
                      transformOrigin: "center center",
                      transition: "transform 0.25s ease",
                    }}
                  />

                  {/* Live Detection Canvas Overlay */}
                  {liveDetectEnabled && (
                    <>
                      <canvas
                        ref={liveOverlayRef}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                          zIndex: 20,
                        }}
                      />
                      <canvas ref={liveOffscreenRef} style={{ display: "none" }} />

                      {/* Live Detection HUD */}
                      <div
                        style={{
                          position: "absolute",
                          bottom: "10px",
                          left: "10px",
                          right: "10px",
                          pointerEvents: "none",
                          zIndex: 20,
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            backgroundColor: "rgba(15, 23, 42, 0.9)",
                            backdropFilter: "blur(6px)",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid rgba(34,197,94,0.4)",
                          }}
                        >
                          <div style={{ color: "#22c55e", fontSize: "0.76rem", fontWeight: 700, marginBottom: "4px" }}>
                            ● LIVE DETECTION {liveInferenceMs > 0 ? `(${liveInferenceMs}ms)` : ""}
                          </div>
                          {liveDetectionState.productName && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>PRODUCT: {liveDetectionState.productName}</div>
                          )}
                          {liveDetectionState.mrp && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>MRP: {liveDetectionState.mrp}</div>
                          )}
                          {liveDetectionState.netQuantity && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>NET QTY: {liveDetectionState.netQuantity}</div>
                          )}
                          {liveDetectionState.manufacturer && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>MFR: {liveDetectionState.manufacturer}</div>
                          )}
                          {liveDetectionState.date && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>DATE: {liveDetectionState.date}</div>
                          )}
                          {!liveDetectionState.productName && !liveDetectionState.mrp && (
                            <div style={{ color: "#f59e0b", fontSize: "0.7rem" }}>Waiting for package detection...</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Tier 0 HUD Overlay */}
                  {!liveDetectEnabled && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        pointerEvents: "none",
                        zIndex: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          backgroundColor: "rgba(15, 23, 42, 0.88)",
                          backdropFilter: "blur(6px)",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.76rem",
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span
                            className="status-dot"
                            style={{ backgroundColor: serverGate?.state === "CAPTURE_READY" ? "#10b981" : "#f59e0b" }}
                          />
                          <b>
                            {serverGate?.state === "CAPTURE_READY"
                              ? "PACKAGE DETECTED — READY TO CAPTURE"
                              : serverGate?.state === "PACKAGE_DETECTED"
                                ? "PACKAGE DETECTED"
                                : serverGate?.state === "QUALITY_INSUFFICIENT"
                                  ? "IMAGE QUALITY INSUFFICIENT"
                                  : "LOOKING FOR PACKAGE..."}
                          </b>
                        </span>
                        <span style={{ fontSize: "0.7rem", opacity: 0.75 }}>Package Gate</span>
                      </div>

                      <div
                        style={{
                          backgroundColor: serverGate?.state === "CAPTURE_READY" ? "rgba(16, 185, 129, 0.9)" : "rgba(180, 83, 9, 0.9)",
                          backdropFilter: "blur(6px)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          border: "1px solid rgba(255,255,255,0.25)",
                        }}
                      >
                        <span>{serverGate?.state === "CAPTURE_READY" ? "✓" : "💡"}</span>
                        <span>{serverGate?.tip || "Looking for package..."}</span>
                      </div>
                      {tier0Result && !tier0Result.isReady && (
                        <div
                          style={{
                            backgroundColor: "rgba(15, 23, 42, 0.85)",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            color: "#fcd34d",
                            fontSize: "0.74rem",
                            border: "1px solid rgba(255,255,255,0.15)",
                          }}
                        >
                          Sensor: {tier0Result.tip}
                        </div>
                      )}
                    </div>
                  )}

                {/* Reticle guide overlay */}
                <div
                  style={{
                    position: "absolute",
                    top: "15%",
                    left: "10%",
                    right: "10%",
                    bottom: "15%",
                    border: "2px dashed rgba(255,255,255,0.4)",
                    borderRadius: "12px",
                    pointerEvents: "none",
                  }}
                />
              </div>

              {/* Capture Action Bar */}
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: "10px",
                  background: "#0f172a",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <button
                  type="button"
                  className="button primary"
                  onClick={() => captureFrame(false)}
                  style={{
                    fontSize: "14px",
                    padding: "8px 18px",
                    backgroundColor: "#16a34a",
                    borderColor: "#22c55e",
                    fontWeight: 700,
                  }}
                >
                  <Camera size={16} /> Capture Photo ({sessionCapturedCount} Staged)
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => captureFrame(true)}
                  style={{ fontSize: "14px", padding: "8px 14px" }}
                >
                  Capture & Done
                </button>
              </div>
            </div>
          )}

          {cameraError && (
            <div style={{ color: "#ef4444", fontSize: "0.82rem", marginTop: "8px" }}>
              <b>Camera Error:</b> {cameraError}
            </div>
          )}
        </section>

        {/* Reference-style feature strip */}
        <div className="scanner-feature-strip">
          <div className="scanner-feature">
            <div className="scanner-feature-icon purple">
              <Camera size={18} />
            </div>
            <div>
              <strong>Multi-Angle Capture</strong>
              <span>Front, Back, MRP/Date panel, Ingredients</span>
            </div>
          </div>

          <div className="scanner-feature">
            <div className="scanner-feature-icon green">
              <ScanLine size={18} />
            </div>
            <div>
              <strong>Smart Extraction</strong>
              <span>OCR + YOLO + Validation</span>
            </div>
          </div>

          <div className="scanner-feature">
            <div className="scanner-feature-icon orange">
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong>Compliance Check</strong>
              <span>Legal Metrology Rules</span>
            </div>
          </div>

          <div className="scanner-feature">
            <div className="scanner-feature-icon blue">
              <BarChart3 size={18} />
            </div>
            <div>
              <strong>Detailed Reports</strong>
              <span>Analysis &amp; Export</span>
            </div>
          </div>
        </div>

        {/* Action / Execution Sidebar */}
        <section className="analysis-panel">
          <div className="panel-title">
            <span className="analysis-panel-icon" aria-hidden="true"><FileText size={20} /></span>
            <div>
              <span className="eyebrow">PIPELINE EXECUTION</span>
              <h2>Run Inspection</h2>
            </div>
          </div>

          <div className="pipeline-steps-grid">
            {phaseOrder.map((p, index) => {
              const currentPhaseIndex = phaseOrder.indexOf(phase);
              const isPast = currentPhaseIndex > index;
              const isCurrent = currentPhaseIndex === index;
              const stepIcon = p === "image" ? <ImageIcon size={15} />
                : p === "text" ? <ScanLine size={15} />
                : p === "declarations" ? <FileText size={15} />
                : p === "rules" ? <ShieldCheck size={15} />
                : <Check size={15} />;
              return (
                <div
                  key={p}
                  className={`pipeline-step-card ${isPast ? "done" : isCurrent ? "active" : ""}`}
                >
                  <div className="pipeline-step-header">
                    <div className="pipeline-step-badge">
                      {isPast ? <Check size={12} /> : <span>{index + 1}</span>}
                    </div>
                    {isCurrent && <span className="pipeline-step-live-dot" />}
                  </div>
                  <div className="pipeline-step-icon" aria-hidden="true">{stepIcon}</div>
                  <div className="pipeline-step-content">
                    <strong className="pipeline-step-title">{phaseCopy[p].label}</strong>
                    <span className="pipeline-step-desc">{phaseCopy[p].detail}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <button
              className="button primary"
              disabled={isAnalyzing || (images.length === 0 && (!activeFiles || activeFiles.length === 0))}
              onClick={onAnalyze}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "15px",
                fontWeight: 700,
                justifyContent: "center",
              }}
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw size={16} className="spin" /> Processing Evidence ({elapsed}s)...
                </>
              ) : (
                <>
                  <ScanLine size={16} /> Run Statutory Compliance Analysis
                </>
              )}
            </button>

            <div style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center" }}>
              Deterministic YOLO/layout detection + regional OCR · LM (PC) Rules 2011
            </div>
          </div>

          {recentInspections.length > 0 && (
            <div className="recent-analyses">
              <div className="recent-analyses-head">
                <strong className="recent-analyses-title">Recent Analyses</strong>
                <button className="recent-analyses-link" type="button" onClick={() => onOpenInspection?.(recentInspections[0])}>
                  View All <ArrowUpRight size={11} />
                </button>
              </div>
              {recentInspections.slice(0, 3).map((item) => (
                <button className="recent-analysis-row" type="button" key={item.id} onClick={() => onOpenInspection?.(item)}>
                  <span className="recent-analysis-icon"><FileText size={13} /></span>
                  <span className="recent-analysis-copy">
                    <span className="recent-analysis-name">{item.productName || item.id || "Package analysis"}</span>
                    <span className="recent-analysis-date">{new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</span>
                  </span>
                  <span className="recent-analysis-status">{item.status === "pass" ? "Completed" : item.status}</span>
                  <ChevronRight size={13} color="#3155a4" />
                </button>
              ))}
            </div>
          )}
        </section>

        {currentImage && isImagePreviewOpen && (
          <div
            className="evidence-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded evidence image"
            onClick={() => setIsImagePreviewOpen(false)}
          >
            <button
              className="evidence-lightbox-close"
              type="button"
              aria-label="Close expanded image"
              onClick={() => setIsImagePreviewOpen(false)}
            >
              <X size={20} />
            </button>
            <img
              className="evidence-lightbox-image"
              src={currentImage.uri}
              alt={`Expanded evidence frame ${selectedImageIndex + 1}`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

