import type { Storage } from "@dmc--98/blindfold-auth";

/**
 * @dmc--98/blindfold-risk — adaptive ("dynamic") security for Blindfold Auth.
 *
 * Turns the raw signals the runtime already records into a risk score and a
 * step-up decision, then writes the assessment to the `risk_events` table the
 * schema reserves. The intended wiring: after a password/passkey login, call
 * `assess()`; if `requireStepUp` is true, require a fresh MFA factor before
 * issuing a full-strength session. Sensitive actions can re-assess too.
 *
 *   const risk = createRiskEngine({ storage: auth.storage });
 *   const r = await risk.assess({ principalId, applicationId, context: { ip, deviceId } });
 *   if (r.requireStepUp && !mfaVerified) return challengeMfa();
 *
 * Signals (each contributes weight when active):
 *   - newDevice        : a deviceId never seen for this principal
 *   - newIp            : an IP never seen for this principal
 *   - velocity         : too many assessments within a short window
 *   - impossibleTravel : a different IP seen within the travel window
 *
 * The FIRST assessment for a principal is treated as enrollment (baseline) and
 * is always low risk — otherwise every first login would trip new-device/new-IP.
 */
export interface RiskWeights {
  newDevice: number;
  newIp: number;
  velocity: number;
  impossibleTravel: number;
}

export interface RiskThresholds {
  stepUp: number;
  high: number;
}

export interface RiskConfig {
  weights: RiskWeights;
  thresholds: RiskThresholds;
  velocityWindowMs: number;
  velocityMax: number;
  travelWindowMs: number;
}

export interface RiskSignals {
  newDevice: boolean;
  newIp: boolean;
  velocity: boolean;
  impossibleTravel: boolean;
}

export type RiskLevel = "low" | "medium" | "high";

export interface AssessContext {
  now?: number | string;
  ip?: string | null;
  deviceId?: string | null;
  [key: string]: any;
}

export interface AssessOptions {
  principalId?: string;
  applicationId?: string | null;
  context?: AssessContext;
  record?: boolean;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  signals: RiskSignals;
  requireStepUp: boolean;
  reasons: string[];
  baseline: boolean;
  eventId: string;
}

export interface EnforceResult {
  ok: boolean;
  action?: string;
  level: RiskLevel;
  reasons?: string[];
}

export interface RiskEngineOptions {
  storage?: Storage | any;
  config?: Partial<RiskConfig>;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: { newDevice: 30, newIp: 20, velocity: 25, impossibleTravel: 40 },
  thresholds: { stepUp: 40, high: 60 },
  velocityWindowMs: 60_000,
  velocityMax: 3,
  travelWindowMs: 5 * 60_000
};

function levelFor(score: number, thresholds: RiskThresholds): RiskLevel {
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.stepUp) return "medium";
  return "low";
}

export function createRiskEngine({ storage, config = {} }: RiskEngineOptions = {}) {
  if (!storage || typeof storage.list !== "function" || typeof storage.put !== "function") {
    throw new Error("createRiskEngine requires a storage adapter (list/put)");
  }
  const cfg: RiskConfig = {
    ...DEFAULT_RISK_CONFIG,
    ...config,
    weights: { ...DEFAULT_RISK_CONFIG.weights, ...(config.weights || {}) },
    thresholds: { ...DEFAULT_RISK_CONFIG.thresholds, ...(config.thresholds || {}) }
  };

  async function history(principalId: string): Promise<any[]> {
    const events = await storage.list("risk_events", { principalId });
    return events
      .filter((e: any) => e.type === "risk_assessment")
      .sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /**
   * Assess risk for a principal in a given context. Records a risk_event and
   * returns { score, level, signals, requireStepUp, reasons, baseline }.
   */
  async function assess({ principalId, applicationId = null, context = {}, record = true }: AssessOptions = {}): Promise<RiskAssessment> {
    if (!principalId) {
      throw new Error("assess requires principalId");
    }
    const now = context.now ? new Date(context.now).getTime() : Date.now();
    const ip = context.ip || null;
    const deviceId = context.deviceId || null;
    const prior = await history(principalId);

    const signals: RiskSignals = { newDevice: false, newIp: false, velocity: false, impossibleTravel: false };
    const reasons: string[] = [];
    let baseline = false;

    if (prior.length === 0) {
      baseline = true; // enrollment — establish the baseline, don't penalize
      reasons.push("first assessment for principal (baseline)");
    } else {
      const seenDevices = new Set(prior.map((e: any) => e.deviceId).filter(Boolean));
      const seenIps = new Set(prior.map((e: any) => e.ip).filter(Boolean));

      if (deviceId && !seenDevices.has(deviceId)) {
        signals.newDevice = true;
        reasons.push("unrecognized device");
      }
      if (ip && !seenIps.has(ip)) {
        signals.newIp = true;
        reasons.push("unrecognized IP address");
      }
      const recent = prior.filter((e: any) => now - new Date(e.createdAt).getTime() <= cfg.velocityWindowMs);
      if (recent.length >= cfg.velocityMax) {
        signals.velocity = true;
        reasons.push(`high login velocity (${recent.length} in window)`);
      }
      const travelWindow = prior.filter((e: any) => now - new Date(e.createdAt).getTime() <= cfg.travelWindowMs);
      if (ip && travelWindow.some((e: any) => e.ip && e.ip !== ip)) {
        signals.impossibleTravel = true;
        reasons.push("different IP within travel window");
      }
    }

    let score = 0;
    for (const [key, active] of Object.entries(signals)) {
      if (active) score += cfg.weights[key as keyof RiskWeights] || 0;
    }
    score = Math.min(100, score);
    const level = levelFor(score, cfg.thresholds);
    const requireStepUp = !baseline && score >= cfg.thresholds.stepUp;

    const event = {
      id: `risk_${now}_${Math.random().toString(16).slice(2, 8)}`,
      type: "risk_assessment",
      principalId,
      applicationId,
      ip,
      deviceId,
      score,
      level,
      signals,
      requireStepUp,
      createdAt: new Date(now).toISOString()
    };
    if (record) {
      await storage.put("risk_events", event);
    }

    return { score, level, signals, requireStepUp, reasons, baseline, eventId: event.id };
  }

  /**
   * Gate a sensitive flow on a risk assessment. Returns { ok } when allowed, or
   * { ok:false, action:"step_up_required" } when MFA is needed and not present.
   */
  function enforceStepUp(assessment: RiskAssessment, { mfaVerified = false }: { mfaVerified?: boolean } = {}): EnforceResult {
    if (assessment.requireStepUp && !mfaVerified) {
      return { ok: false, action: "step_up_required", level: assessment.level, reasons: assessment.reasons };
    }
    return { ok: true, level: assessment.level };
  }

  async function listEvents({ principalId }: { principalId?: string } = {}): Promise<any[]> {
    const events = await storage.list("risk_events", principalId ? { principalId } : {});
    return events.sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  return { assess, enforceStepUp, listEvents, config: cfg };
}

export default createRiskEngine;
