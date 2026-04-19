"use client";
import { useState, useEffect, useRef } from "react";

const PERIODS = [
  { label: "Azi", key: "today" },
  { label: "Ieri", key: "yesterday" },
  { label: "Ult. 3 zile", key: "prev3" },
  { label: "Ult. 4 zile", key: "prev4" },
  { label: "Ult. 5 zile", key: "prev5" },
  { label: "Ult. 7 zile", key: "prev7" },
  { label: "Săpt. trecută", key: "last_week" },
  { label: "Luna aceasta", key: "this_month" },
  { label: "Luna trecută", key: "last_month" },
];

type Ad = { id: string; name: string; spend: number; roas: number; thumbnail: string | null; permalink: string | null };
type Campaign = {
  id: string; name: string; sub: string;
  spend: number; revenue: number; roas: number; purchases: number;
  dailyBudget: number | null; createdTime: string | null;
  status: string; objective: string | null;
  bidStrategy: string | null; attribution: string | null;
  ads: Ad[];
  platform?: string;
};
type SortKey = "name" | "spend" | "revenue" | "roas" | "purchases" | "dailyBudget" | "objective" | "bidStrategy" | "attribution" | "status";
type SortDir = "asc" | "desc";
type Platform = "meta" | "google";
type ActionType = "scale" | "reduce" | "stop";
type CampaignActionRecord = { action: ActionType; date: string };

const ACTION_CONFIG: Record<ActionType, { label: string; color: string; bg: string; border: string }> = {
  scale:  { label: "↑ Scalează", color: "#4ADE80", bg: "#0A2E1E", border: "#4ADE8040" },
  reduce: { label: "↓ Reduce",   color: "#FBB024", bg: "#2E1E0A", border: "#FBB02440" },
  stop:   { label: "■ Oprește",  color: "#F87171", bg: "#2E0A0A", border: "#F8717140" },
};

const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const LS_ACTIONS_KEY = "ads_campaign_actions";

// ── Algorithms ──────────────────────────────────────────────────────────────

function calcScaleSuggestion(roas: number, createdTime: string | null) {
  const basePercent = roas > 8 ? 25 : roas >= 6 ? 20 : 15;
  const roasLabel = roas > 8 ? "excepțional" : roas >= 6 ? "foarte bun" : "bun";
  const roasNote = `ROAS ${roas}x ${roasLabel} → bază +${basePercent}%`;

  const ageInDays = createdTime
    ? Math.floor((Date.now() - new Date(createdTime).getTime()) / (1000 * 60 * 60 * 24))
    : 30;

  let multiplier = 1.0;
  let ageNote: string;
  if (ageInDays < 7) {
    multiplier = 0.5;
    ageNote = `Campanie nouă (${ageInDays} zile) — scalare conservatoare`;
  } else if (ageInDays < 14) {
    multiplier = 0.75;
    ageNote = `Campanie în creștere (${ageInDays} zile) — scalare moderată`;
  } else if (ageInDays < 30) {
    ageNote = `Date suficiente (${ageInDays} zile) — scalare normală`;
  } else {
    ageNote = `Campanie matură (${ageInDays} zile) — scalare sigură`;
  }

  const finalPercent = Math.max(10, Math.round(basePercent * multiplier));
  return { finalPercent, roasNote, ageNote };
}

function calcReduceSuggestion(roas: number) {
  if (roas < 1)  return { suggestStop: true,  percent: 0,   reason: `ROAS ${roas}x — campania pierde bani. Recomandăm oprirea.` };
  if (roas < 2)  return { suggestStop: false, percent: -50, reason: `ROAS ${roas}x foarte slab — reducere drastică (-50%)` };
  if (roas < 3)  return { suggestStop: false, percent: -30, reason: `ROAS ${roas}x slab — reducere semnificativă (-30%)` };
  return           { suggestStop: false, percent: -20, reason: `ROAS ${roas}x sub rentabilitate — reducere moderată (-20%)` };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStatus(roas: number, status: string) {
  if (status === "ACTIVE" || status === "ENABLED") {
    if (roas >= 5) return { label: "Scalează", cls: "scale" };
    if (roas >= 4) return { label: "Monitorizare", cls: "watch" };
    return { label: "Activ", cls: "test" };
  }
  if (roas >= 5) return { label: "Scalează", cls: "scale" };
  if (roas >= 4) return { label: "Monitorizare", cls: "watch" };
  if (roas > 0)  return { label: "Oprește", cls: "pause" };
  return { label: "Fără date", cls: "none" };
}

function getRoasColor(roas: number) {
  if (roas >= 5) return "#4ADE80";
  if (roas >= 4) return "#FBB024";
  if (roas > 0)  return "#F87171";
  return "#6B6B8A";
}

function badgeStyle(cls: string) {
  const map: Record<string, { bg: string; color: string }> = {
    scale: { bg: "#0F3D2E", color: "#4ADE80" },
    pause: { bg: "#3D0F0F", color: "#F87171" },
    watch: { bg: "#3D2E0F", color: "#FBB024" },
    test:  { bg: "#0F1E3D", color: "#60A5FA" },
    none:  { bg: "#1A1A2E", color: "#4A4A6A" },
  };
  return map[cls] || map.none;
}

function fmtObjective(obj: string | null) {
  if (!obj) return "—";
  return obj.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function fmtBid(bid: string | null) {
  if (!bid) return "—";
  const map: Record<string, string> = {
    LOWEST_COST_WITHOUT_CAP: "Lowest cost",
    LOWEST_COST_WITH_BID_CAP: "Bid cap",
    COST_CAP: "Cost cap",
    LOWEST_COST_WITH_MIN_ROAS: "Min ROAS",
  };
  return map[bid] || bid.replace(/_/g, " ").toLowerCase();
}

function fmtAttribution(attr: string | null) {
  if (!attr) return "—";
  return attr.replace(/_/g, " ");
}

function sortCampaigns(campaigns: Campaign[], key: SortKey, dir: SortDir): Campaign[] {
  return [...campaigns].sort((a, b) => {
    let av: any, bv: any;
    switch (key) {
      case "name":        av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case "spend":       av = a.spend; bv = b.spend; break;
      case "revenue":     av = a.revenue; bv = b.revenue; break;
      case "roas":        av = a.roas; bv = b.roas; break;
      case "purchases":   av = a.purchases ?? 0; bv = b.purchases ?? 0; break;
      case "dailyBudget": av = a.dailyBudget ?? 0; bv = b.dailyBudget ?? 0; break;
      case "objective":   av = a.objective || ""; bv = b.objective || ""; break;
      case "bidStrategy": av = a.bidStrategy || ""; bv = b.bidStrategy || ""; break;
      case "attribution": av = a.attribution || ""; bv = b.attribution || ""; break;
      case "status":      av = getStatus(a.roas, a.status).label; bv = getStatus(b.roas, b.status).label; break;
      default:            av = a.spend; bv = b.spend;
    }
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AdThumb({ ad }: { ad: Ad }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      title={ad.permalink ? `${ad.name} — click pentru postare` : ad.name}
      onClick={() => ad.permalink && window.open(ad.permalink, "_blank", "noopener,noreferrer")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", width: 52, height: 52, borderRadius: 6, overflow: "hidden", background: "#1A1A2E", flexShrink: 0, cursor: ad.permalink ? "pointer" : "default", outline: hovered && ad.permalink ? "2px solid #6366f1" : "2px solid transparent", transition: "outline 0.1s" }}
    >
      {ad.thumbnail
        ? <img src={ad.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#3A3A5C", fontSize: 16 }}>▶</div>
      }
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.85))", padding: "16px 3px 3px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {ad.roas > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: getRoasColor(ad.roas), fontFamily: "monospace", lineHeight: 1.2 }}>{ad.roas}x</span>}
        {ad.spend > 0 && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.8)", fontFamily: "monospace", lineHeight: 1.2 }}>{ad.spend}L</span>}
      </div>
      {hovered && ad.permalink && (
        <div style={{ position: "absolute", top: 3, right: 3, width: 14, height: 14, background: "rgba(99,102,241,0.9)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, color: "#fff" }}>↗</span>
        </div>
      )}
    </div>
  );
}

function EmptyThumb() {
  return <div style={{ width: 52, height: 52, borderRadius: 6, background: "#0E0E1C", flexShrink: 0, border: "1px dashed #1E1E3A" }} />;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: 9, color: active ? "#A5B4FC" : "#4A4A6A" }}>
      {active ? (dir === "asc" ? "▲" : "▼") : "▲▼"}
    </span>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const cardStyle: React.CSSProperties = { background: "#0F0F1A", border: "1px solid #2A2A4A", borderRadius: 12, padding: "24px 28px", maxWidth: 460, width: "90%", boxShadow: "0 16px 48px rgba(0,0,0,0.8)" };

function BudgetInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6B6B8A", marginBottom: 6 }}>Buget nou <span style={{ color: "#3A3A5C" }}>(editabil)</span></div>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", background: "#0A1510", border: "1px solid #4ADE8040", borderRadius: 7, color: "#4ADE80", padding: "9px 12px", fontSize: 16, fontWeight: 700, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
      />
      <div style={{ fontSize: 10, color: "#2A2A3A", marginTop: 4 }}>lei/zi</div>
    </div>
  );
}

function ScaleModal({ campaign, onConfirm, onCancel }: {
  campaign: Campaign;
  onConfirm: (newBudget: number | null) => void;
  onCancel: () => void;
}) {
  const { finalPercent, roasNote, ageNote } = calcScaleSuggestion(campaign.roas, campaign.createdTime);
  const suggestedBudget = campaign.dailyBudget ? Math.round(campaign.dailyBudget * (1 + finalPercent / 100)) : null;
  const [inputBudget, setInputBudget] = useState(suggestedBudget ? String(suggestedBudget) : "");
  const cfg = ACTION_CONFIG.scale;

  return (
    <div onClick={onCancel} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: cfg.color, marginBottom: 4 }}>↑ Sugestie scalare</div>
        <div style={{ fontSize: 11, color: "#4A4A6A", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={campaign.name}>{campaign.name}</div>

        <div style={{ background: "#0A2218", border: "1px solid #4ADE8022", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: cfg.color, fontWeight: 600, marginBottom: 3 }}>{roasNote}</div>
          <div style={{ fontSize: 11, color: "#86EFAC", marginBottom: 6 }}>{ageNote}</div>
          <div style={{ fontSize: 13, color: cfg.color, fontWeight: 700 }}>Scalare sugerată: +{finalPercent}%</div>
        </div>

        {campaign.dailyBudget ? (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: "#6B6B8A" }}>
              <span>Buget curent: <span style={{ color: "#C0C0D8", fontFamily: "monospace" }}>{campaign.dailyBudget.toLocaleString("ro-RO")} lei/zi</span></span>
              <span>Sugestie: <span style={{ color: cfg.color, fontFamily: "monospace" }}>{suggestedBudget?.toLocaleString("ro-RO")} lei/zi</span></span>
            </div>
            <BudgetInput value={inputBudget} onChange={setInputBudget} />
          </div>
        ) : (
          <div style={{ background: "#1A1A2E", borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 11, color: "#7070A0", lineHeight: 1.6 }}>
            Bugetul e setat la nivel de ad set — nu poate fi modificat automat. Decizia va fi înregistrată local.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #2A2A4A", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Anulează</button>
          <button
            onClick={() => onConfirm(campaign.dailyBudget ? (parseFloat(inputBudget) || null) : null)}
            style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${cfg.border}`, background: cfg.bg, color: cfg.color, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            {campaign.dailyBudget ? "Aplică bugetul" : "Înregistrează decizia"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReduceModal({ campaign, onConfirm, onCancel }: {
  campaign: Campaign;
  onConfirm: (newBudget: number | null, action: ActionType) => void;
  onCancel: () => void;
}) {
  const { suggestStop, percent, reason } = calcReduceSuggestion(campaign.roas);
  const cfgReduce = ACTION_CONFIG.reduce;
  const cfgStop = ACTION_CONFIG.stop;
  const suggestedBudget = (!suggestStop && campaign.dailyBudget && percent < 0)
    ? Math.round(campaign.dailyBudget * (1 + percent / 100))
    : null;
  const [inputBudget, setInputBudget] = useState(suggestedBudget ? String(suggestedBudget) : "");

  if (suggestStop) {
    return (
      <div onClick={onCancel} style={overlayStyle}>
        <div onClick={e => e.stopPropagation()} style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: cfgStop.color, marginBottom: 4 }}>■ Oprește campania</div>
          <div style={{ fontSize: 11, color: "#4A4A6A", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={campaign.name}>{campaign.name}</div>
          <div style={{ background: "#2E0A0A", border: "1px solid #F8717122", borderRadius: 8, padding: "12px 14px", marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: cfgStop.color, fontWeight: 600, marginBottom: 4 }}>{reason}</div>
            <div style={{ fontSize: 11, color: "#F8A0A0" }}>Reducerea bugetului nu va salva campania — cel mai bun pas e oprirea.</div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #2A2A4A", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Anulează</button>
            <button onClick={() => onConfirm(null, "stop")} style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${cfgStop.border}`, background: cfgStop.bg, color: cfgStop.color, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>■ Oprește campania</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onCancel} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: cfgReduce.color, marginBottom: 4 }}>↓ Sugestie reducere</div>
        <div style={{ fontSize: 11, color: "#4A4A6A", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={campaign.name}>{campaign.name}</div>

        <div style={{ background: "#2A1500", border: "1px solid #FBB02422", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: cfgReduce.color, fontWeight: 600, marginBottom: 3 }}>{reason}</div>
          <div style={{ fontSize: 13, color: cfgReduce.color, fontWeight: 700, marginTop: 4 }}>Reducere sugerată: {percent}%</div>
        </div>

        {campaign.dailyBudget ? (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: "#6B6B8A" }}>
              <span>Buget curent: <span style={{ color: "#C0C0D8", fontFamily: "monospace" }}>{campaign.dailyBudget.toLocaleString("ro-RO")} lei/zi</span></span>
              <span>Sugestie: <span style={{ color: cfgReduce.color, fontFamily: "monospace" }}>{suggestedBudget?.toLocaleString("ro-RO")} lei/zi</span></span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B6B8A", marginBottom: 6 }}>Buget nou <span style={{ color: "#3A3A5C" }}>(editabil)</span></div>
              <input
                type="number"
                value={inputBudget}
                onChange={e => setInputBudget(e.target.value)}
                style={{ width: "100%", background: "#150A00", border: "1px solid #FBB02440", borderRadius: 7, color: "#FBB024", padding: "9px 12px", fontSize: 16, fontWeight: 700, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 10, color: "#2A2A3A", marginTop: 4 }}>lei/zi</div>
            </div>
          </div>
        ) : (
          <div style={{ background: "#1A1A2E", borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 11, color: "#7070A0", lineHeight: 1.6 }}>
            Bugetul e setat la nivel de ad set — nu poate fi modificat automat. Decizia va fi înregistrată local.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #2A2A4A", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Anulează</button>
          <button
            onClick={() => onConfirm(campaign.dailyBudget ? (parseFloat(inputBudget) || null) : null, "reduce")}
            style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${cfgReduce.border}`, background: cfgReduce.bg, color: cfgReduce.color, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            {campaign.dailyBudget ? "Aplică reducerea" : "Înregistrează decizia"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StopModal({ campaign, onConfirm, onCancel }: {
  campaign: Campaign;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cfg = ACTION_CONFIG.stop;
  return (
    <div onClick={onCancel} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: cfg.color, marginBottom: 10 }}>■ Oprește campania</div>
        <div style={{ fontSize: 12, color: "#9090B0", marginBottom: 8 }}>Campania va fi setată pe <strong style={{ color: "#F87171" }}>PAUSED</strong> în Meta Ads:</div>
        <div style={{ padding: "8px 12px", background: "#1A1A2E", borderRadius: 6, color: "#D0D0E8", fontSize: 12, fontWeight: 500, marginBottom: 14, wordBreak: "break-word" }}>{campaign.name}</div>
        <div style={{ fontSize: 11, color: "#4A4A6A", marginBottom: 20 }}>Decizia va fi înregistrată local. Butoanele vor fi blocate 3 zile.</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #2A2A4A", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Anulează</button>
          <button onClick={onConfirm} style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${cfg.border}`, background: cfg.bg, color: cfg.color, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>■ Oprește campania</button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [platform, setPlatform] = useState<Platform>("meta");
  const [period, setPeriod] = useState("prev7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);

  const [metaCampaigns, setMetaCampaigns] = useState<Campaign[]>([]);
  const [metaSummary, setMetaSummary] = useState({ totalSpend: 0, totalRevenue: 0, totalRoas: 0, eligible: 0 });
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState("");

  const [googleCampaigns, setGoogleCampaigns] = useState<Campaign[]>([]);
  const [googleSummary, setGoogleSummary] = useState({ totalSpend: 0, totalRevenue: 0, totalRoas: 0, eligible: 0 });
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleError, setGoogleError] = useState("");

  const [filter, setFilter] = useState<"active" | "paused" | "all">("active");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [plannedDailyBudget, setPlannedDailyBudget] = useState<string>("");
  const [plannedBudgetDate, setPlannedBudgetDate] = useState<string>("");
  const [editingBudget, setEditingBudget] = useState(false);

  const [campaignActions, setCampaignActions] = useState<Record<string, CampaignActionRecord>>({});
  const [scaleModal, setScaleModal] = useState<Campaign | null>(null);
  const [reduceModal, setReduceModal] = useState<Campaign | null>(null);
  const [stopModal, setStopModal] = useState<Campaign | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("plannedDailyBudget");
    const savedDate = localStorage.getItem("plannedBudgetDate");
    if (saved) setPlannedDailyBudget(saved);
    if (savedDate) setPlannedBudgetDate(savedDate);
    const savedActions = localStorage.getItem(LS_ACTIONS_KEY);
    if (savedActions) setCampaignActions(JSON.parse(savedActions));
  }, []);

  function savePlannedBudget(value: string) {
    setEditingBudget(false);
    localStorage.setItem("plannedDailyBudget", value);
    const now = new Date().toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    setPlannedBudgetDate(now);
    localStorage.setItem("plannedBudgetDate", now);
  }

  function recordAction(campaignId: string, action: ActionType) {
    const record: CampaignActionRecord = { action, date: new Date().toISOString() };
    const updated = { ...campaignActions, [campaignId]: record };
    setCampaignActions(updated);
    localStorage.setItem(LS_ACTIONS_KEY, JSON.stringify(updated));
  }

  async function confirmScale(campaign: Campaign, newBudget: number | null) {
    recordAction(campaign.id, "scale");
    if (newBudget !== null) {
      await fetch("/api/meta/update-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, newBudget }),
      });
    }
    setScaleModal(null);
  }

  async function confirmReduce(campaign: Campaign, newBudget: number | null, action: ActionType) {
    recordAction(campaign.id, action);
    if (newBudget !== null) {
      await fetch("/api/meta/update-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, newBudget }),
      });
    }
    if (action === "stop") {
      await fetch("/api/meta/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, status: "PAUSED" }),
      });
    }
    setReduceModal(null);
  }

  async function confirmStop(campaign: Campaign) {
    recordAction(campaign.id, "stop");
    await fetch("/api/meta/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: campaign.id, status: "PAUSED" }),
    });
    setStopModal(null);
  }

  function getCooldownDaysLeft(campaignId: string): number {
    const rec = campaignActions[campaignId];
    if (!rec) return 0;
    const remaining = COOLDOWN_MS - (Date.now() - new Date(rec.date).getTime());
    return remaining > 0 ? Math.ceil(remaining / (24 * 60 * 60 * 1000)) : 0;
  }

  const menuRef = useRef<HTMLDivElement>(null);
  const activePeriodLabel = PERIODS.find(p => p.key === period)?.label || "Personalizat";

  function getPeriodDates(p: string): string | null {
    const fmt = (d: Date) => d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" });
    const today = new Date();
    const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    if (p.includes("|")) return `${p.split("|")[0]} → ${p.split("|")[1]}`;
    switch (p) {
      case "today":      return fmt(today);
      case "yesterday":  return fmt(daysAgo(1));
      case "prev3":      return `${fmt(daysAgo(3))} → ${fmt(daysAgo(1))}`;
      case "prev4":      return `${fmt(daysAgo(4))} → ${fmt(daysAgo(1))}`;
      case "prev5":      return `${fmt(daysAgo(5))} → ${fmt(daysAgo(1))}`;
      case "prev7":      return `${fmt(daysAgo(7))} → ${fmt(daysAgo(1))}`;
      case "last_week": {
        const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() - 6);
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return `${fmt(mon)} → ${fmt(sun)}`;
      }
      case "this_month": return `${fmt(new Date(today.getFullYear(), today.getMonth(), 1))} → ${fmt(today)}`;
      case "last_month": {
        const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const e = new Date(today.getFullYear(), today.getMonth(), 0);
        return `${fmt(s)} → ${fmt(e)}`;
      }
      default: return null;
    }
  }

  function getPeriodDays(p: string): number {
    const today = new Date();
    if (p === "today") return 1;
    if (p === "yesterday") return 1;
    if (p === "prev3") return 3;
    if (p === "prev4") return 4;
    if (p === "prev5") return 5;
    if (p === "prev7") return 7;
    if (p === "last_week") return 7;
    if (p === "this_month") return today.getDate();
    if (p === "last_month") return new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    if (p.includes("|")) {
      const [since, until] = p.split("|");
      return Math.max(1, Math.round((new Date(until).getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)) + 1);
    }
    return 7;
  }

  const activePeriodDates = getPeriodDates(period);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowPeriodMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function fetchMeta(p: string) {
    setMetaLoading(true); setMetaError("");
    fetch(`/api/meta?period=${encodeURIComponent(p)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setMetaError(data.error); setMetaLoading(false); return; }
        setMetaCampaigns(data.campaigns || []);
        setMetaSummary({ totalSpend: data.totalSpend, totalRevenue: data.totalRevenue, totalRoas: data.totalRoas, eligible: data.eligible });
        setMetaLoading(false);
      })
      .catch(e => { setMetaError(e.message); setMetaLoading(false); });
  }

  function fetchGoogle(p: string) {
    setGoogleLoading(true); setGoogleError("");
    fetch(`/api/google?period=${encodeURIComponent(p)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setGoogleError(data.error); setGoogleLoading(false); return; }
        setGoogleCampaigns(data.campaigns || []);
        setGoogleSummary({ totalSpend: data.totalSpend, totalRevenue: data.totalRevenue, totalRoas: data.totalRoas, eligible: data.eligible });
        setGoogleLoading(false);
      })
      .catch(e => { setGoogleError(e.message); setGoogleLoading(false); });
  }

  useEffect(() => {
    if (!period.includes("|") && period !== "custom") {
      fetchMeta(period);
      fetchGoogle(period);
    }
  }, [period]);

  function applyCustom() {
    if (!customFrom || !customTo) return;
    const key = `${customFrom}|${customTo}`;
    setShowCustom(false); setShowPeriodMenu(false);
    setPeriod(key);
    fetchMeta(key);
    fetchGoogle(key);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const campaigns = platform === "meta" ? metaCampaigns : googleCampaigns;
  const summary = platform === "meta" ? metaSummary : googleSummary;
  const loading = platform === "meta" ? metaLoading : googleLoading;
  const error = platform === "meta" ? metaError : googleError;

  const isActive = (c: Campaign) => c.status === "ACTIVE" || c.status === "ENABLED";
  const activeCamps = campaigns.filter(isActive);
  const scalabile = campaigns.filter(c => c.roas >= 5);

  const filtered = campaigns.filter(c => {
    if (filter === "active") return isActive(c);
    if (filter === "paused") return !isActive(c);
    return true;
  });
  const sorted = sortCampaigns(filtered, sortKey, sortDir);

  const days = getPeriodDays(period);
  const dailyReal = days > 0 ? Math.round(summary.totalSpend / days) : 0;
  const planned = parseInt(plannedDailyBudget) || 0;
  const diff = dailyReal - planned;
  const diffColor = diff > 0 ? "#4ADE80" : diff < 0 ? "#F87171" : "#6B6B8A";
  const diffLabel = diff > 0 ? `+${diff.toLocaleString("ro-RO")} lei peste plan` : diff < 0 ? `${diff.toLocaleString("ro-RO")} lei sub plan` : "conform planului";

  // 11 cols for meta: name | creative | budget | spend | revenue | roas | purchases | objective | bidStrategy | attribution | status
  const COL = platform === "meta"
    ? "minmax(0,2fr) 300px minmax(0,90px) minmax(0,90px) minmax(0,100px) minmax(0,70px) minmax(0,80px) minmax(0,110px) minmax(0,110px) minmax(0,100px) minmax(0,100px)"
    : "minmax(0,2fr) minmax(0,90px) minmax(0,100px) minmax(0,70px) minmax(0,110px) minmax(0,110px) minmax(0,100px)";

  const mono = { fontFamily: "'DM Mono', monospace" } as const;

  function ColHeader({ label, k, align = "right" }: { label: string; k: SortKey; align?: string }) {
    return (
      <div onClick={() => handleSort(k)} style={{ textAlign: align as any, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start", gap: 2 }}>
        <span style={{ color: sortKey === k ? "#A5B4FC" : "#4A4A6A" }}>{label}</span>
        <SortIcon active={sortKey === k} dir={sortDir} />
      </div>
    );
  }

  return (
    <main style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#0A0A0F", color: "#E8E8F0", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {scaleModal  && <ScaleModal  campaign={scaleModal}  onConfirm={(b)        => confirmScale(scaleModal, b)}           onCancel={() => setScaleModal(null)}  />}
      {reduceModal && <ReduceModal campaign={reduceModal} onConfirm={(b, act)   => confirmReduce(reduceModal, b, act)}     onCancel={() => setReduceModal(null)} />}
      {stopModal   && <StopModal   campaign={stopModal}   onConfirm={()         => confirmStop(stopModal)}                 onCancel={() => setStopModal(null)}   />}

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1E1E2E", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>A</div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ads Dashboard</span>
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            <button onClick={() => setPlatform("meta")} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid", borderColor: platform === "meta" ? "#1877F2" : "#1E1E2E", background: platform === "meta" ? "#1877F215" : "transparent", color: platform === "meta" ? "#60A5FA" : "#6B6B8A", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: platform === "meta" ? 600 : 400 }}>f Meta</button>
            <button onClick={() => setPlatform("google")} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid", borderColor: platform === "google" ? "#EA4335" : "#1E1E2E", background: platform === "google" ? "#EA433515" : "transparent", color: platform === "google" ? "#F87171" : "#6B6B8A", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: platform === "google" ? 600 : 400 }}>G Google</button>
          </div>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#0F3D2E", color: "#4ADE80", border: "1px solid #1D9E7530" }}>● Live</span>
        </div>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowPeriodMenu(v => !v)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #2A2A4A", background: "#0F0F1A", color: "#A5B4FC", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📅</span>
            <span>{activePeriodLabel}</span>
            {activePeriodDates && <span style={{ color: "#6B6B8A", fontSize: 11, borderLeft: "1px solid #2A2A4A", paddingLeft: 8 }}>{activePeriodDates}</span>}
            <span style={{ color: "#4A4A6A" }}>▾</span>
          </button>
          {showPeriodMenu && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 10, padding: 8, zIndex: 100, minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
              {PERIODS.map(p => (
                <button key={p.key} onClick={() => { setPeriod(p.key); setShowPeriodMenu(false); setShowCustom(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", borderRadius: 6, border: "none", background: period === p.key ? "#1E1E3A" : "transparent", color: period === p.key ? "#A5B4FC" : "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  {p.label}
                </button>
              ))}
              <div style={{ borderTop: "1px solid #1E1E2E", marginTop: 6, paddingTop: 6 }}>
                <button onClick={() => setShowCustom(v => !v)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", borderRadius: 6, border: "none", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Personalizat ▸</button>
                {showCustom && (
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ background: "#1A1A2E", border: "1px solid #2A2A4A", borderRadius: 6, color: "#E8E8F0", padding: "5px 8px", fontSize: 12, fontFamily: "inherit" }} />
                    <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ background: "#1A1A2E", border: "1px solid #2A2A4A", borderRadius: 6, color: "#E8E8F0", padding: "5px 8px", fontSize: 12, fontFamily: "inherit" }} />
                    <button onClick={applyCustom} style={{ padding: "6px", borderRadius: 6, border: "none", background: "#6366f1", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>Aplică</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "18px 24px", width: "100%", boxSizing: "border-box" }}>
        {loading && <div style={{ textAlign: "center", padding: "60px 0", color: "#6B6B8A", fontSize: 13 }}>Se încarcă datele din {platform === "meta" ? "Meta" : "Google Ads"}...</div>}
        {error && <div style={{ padding: "12px 16px", background: "#3D0F0F", border: "1px solid #F8717130", borderRadius: 8, color: "#F87171", fontSize: 12, marginBottom: 16 }}>Eroare {platform === "meta" ? "Meta" : "Google"}: {error}</div>}

        {!loading && !error && (
          <>
            {/* Summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginBottom: 16 }}>
              {[
                { label: "ROAS total", value: summary.totalRoas + "x", color: summary.totalRoas >= 5 ? "#4ADE80" : summary.totalRoas >= 3 ? "#FBB024" : "#F87171" },
                { label: "Buget cheltuit", value: summary.totalSpend.toLocaleString("ro-RO") + " lei", color: "#E8E8F0" },
                { label: "Venituri generate", value: summary.totalRevenue.toLocaleString("ro-RO") + " lei", color: "#E8E8F0" },
                { label: "Campanii active", value: String(activeCamps.length), color: "#E8E8F0" },
                { label: "Eligibili scalare", value: String(summary.eligible), color: "#4ADE80" },
              ].map((m, i) => (
                <div key={i} style={{ background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#6B6B8A", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: m.color, ...mono }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Daily budget */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#6B6B8A", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Buget mediu zilnic real <span style={{ color: "#3A3A5C" }}>({days} {days === 1 ? "zi" : "zile"})</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#E8E8F0", ...mono }}>{dailyReal.toLocaleString("ro-RO")} lei</div>
                  {planned > 0 && <div style={{ fontSize: 11, color: diffColor, ...mono }}>{diffLabel}</div>}
                </div>
              </div>
              <div style={{ background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "12px 14px", cursor: "pointer" }} onClick={() => setEditingBudget(true)}>
                <div style={{ fontSize: 10, color: "#6B6B8A", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Buget mediu zilnic planificat <span style={{ color: "#6366f1", fontSize: 9 }}>✎ editabil</span>
                </div>
                {editingBudget ? (
                  <input autoFocus type="number" value={plannedDailyBudget} onChange={e => setPlannedDailyBudget(e.target.value)} onBlur={() => savePlannedBudget(plannedDailyBudget)} onKeyDown={e => e.key === "Enter" && savePlannedBudget(plannedDailyBudget)} placeholder="ex: 1500" style={{ background: "transparent", border: "none", borderBottom: "1px solid #6366f1", color: "#E8E8F0", fontSize: 18, fontWeight: 600, ...mono, outline: "none", width: "100%", padding: "0 0 2px 0" }} />
                ) : (
                  <div style={{ fontSize: 18, fontWeight: 600, color: plannedDailyBudget ? "#A5B4FC" : "#2A2A4A", ...mono }}>
                    {plannedDailyBudget ? (
                      <>
                        <span>{parseInt(plannedDailyBudget).toLocaleString("ro-RO")} lei</span>
                        {plannedBudgetDate && <span style={{ fontSize: 10, color: "#4A4A6A", marginLeft: 8, fontFamily: "inherit", fontWeight: 400 }}>actualizat {plannedBudgetDate}</span>}
                      </>
                    ) : "click pentru a seta..."}
                  </div>
                )}
              </div>
            </div>

            {/* Alert */}
            {scalabile.length > 0 && (
              <div style={{ background: "#0B2E1F", border: "1px solid #1D9E7530", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#4ADE80", fontSize: 14, flexShrink: 0 }}>↑</span>
                <div style={{ fontSize: 12, color: "#4ADE80" }}>
                  <strong>{scalabile.length} eligibilă pentru scalare (ROAS ≥ 5):</strong>{" "}
                  <span style={{ color: "#86EFAC" }}>{scalabile.map(c => `${c.name.split("/").pop()?.trim()} (${c.roas}x)`).join(" · ")}</span>
                </div>
              </div>
            )}

            {/* Filter */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["active", "paused", "all"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 12px", borderRadius: 12, border: "1px solid", borderColor: filter === f ? "#6366f1" : "#1E1E2E", background: filter === f ? "#6366f115" : "transparent", color: filter === f ? "#A5B4FC" : "#6B6B8A", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                  {f === "all" ? `Toate (${campaigns.length})` : f === "active" ? `Active (${activeCamps.length})` : `Paused (${campaigns.length - activeCamps.length})`}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ width: "100%", overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: COL, gap: 8, padding: "0 10px 7px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: platform === "meta" ? 1400 : 900 }}>
                <ColHeader label="Campanie" k="name" align="left" />
                {platform === "meta" && <div style={{ color: "#4A4A6A" }}>Top 5 creative</div>}
                {platform === "meta" && <ColHeader label="Buget/zi" k="dailyBudget" align="right" />}
                <ColHeader label="Cheltuit" k="spend" align="right" />
                <ColHeader label="Venituri" k="revenue" align="right" />
                <ColHeader label="ROAS" k="roas" align="right" />
                {platform === "meta" && <ColHeader label="Purchases" k="purchases" align="right" />}
                <ColHeader label="Obiectiv" k="objective" align="center" />
                <ColHeader label="Bid strategy" k="bidStrategy" align="center" />
                {platform === "meta" && <ColHeader label="Attribution" k="attribution" align="center" />}
                <ColHeader label="Status" k="status" align="right" />
              </div>

              <div style={{ minWidth: platform === "meta" ? 1400 : 900 }}>
                {sorted.map(c => {
                  const st = getStatus(c.roas, c.status);
                  const bs = badgeStyle(st.cls);
                  const thumbSlots = platform === "meta" ? Array.from({ length: 5 }, (_, i) => c.ads[i] || null) : [];
                  const daysLeft = getCooldownDaysLeft(c.id);
                  const lastAction = campaignActions[c.id];
                  return (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: COL, gap: 8, padding: "8px 10px", background: "#0D0D1A", border: "1px solid #16162A", borderRadius: 7, marginBottom: 3, alignItems: "center" }}>
                      {/* Campaign name + action buttons */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 12, color: "#D0D0E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</div>
                        <div style={{ fontSize: 10, color: "#4A4A6A", marginTop: 1 }}>{c.sub}</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                          {(["scale", "reduce", "stop"] as ActionType[]).map(act => {
                            const cfg = ACTION_CONFIG[act];
                            const disabled = daysLeft > 0;
                            return (
                              <button
                                key={act}
                                disabled={disabled}
                                title={disabled ? `Cooldown: mai ai ${daysLeft} ${daysLeft === 1 ? "zi" : "zile"}` : cfg.label}
                                onClick={() => {
                                  if (disabled) return;
                                  if (act === "scale")  setScaleModal(c);
                                  if (act === "reduce") setReduceModal(c);
                                  if (act === "stop")   setStopModal(c);
                                }}
                                style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${disabled ? "#1E1E2E" : cfg.border}`, background: disabled ? "transparent" : cfg.bg, color: disabled ? "#2E2E4A" : cfg.color, fontSize: 9, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                              >
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                        {lastAction && (() => {
                          const cfg = ACTION_CONFIG[lastAction.action];
                          const dateStr = new Date(lastAction.date).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "2-digit" });
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>{cfg.label} · {dateStr}</span>
                              {daysLeft > 0 && <span style={{ fontSize: 9, color: "#3A3A5C" }}>cooldown {daysLeft}z</span>}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Creative thumbnails */}
                      {platform === "meta" && (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {thumbSlots.map((ad, i) => ad ? <AdThumb key={ad.id} ad={ad} /> : <EmptyThumb key={i} />)}
                        </div>
                      )}

                      {/* Daily budget */}
                      {platform === "meta" && (
                        <div style={{ textAlign: "right", fontSize: 12, color: c.dailyBudget ? "#A5B4FC" : "#2E2E4A", ...mono }}>
                          {c.dailyBudget ? c.dailyBudget.toLocaleString("ro-RO") + " L" : "ad set"}
                        </div>
                      )}

                      <div style={{ textAlign: "right", fontSize: 12, color: "#C0C0D8", ...mono }}>{c.spend > 0 ? c.spend.toLocaleString("ro-RO") + " L" : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "#C0C0D8", ...mono }}>{c.revenue > 0 ? c.revenue.toLocaleString("ro-RO") + " L" : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: getRoasColor(c.roas), ...mono }}>{c.roas > 0 ? c.roas + "x" : "—"}</div>
                      {platform === "meta" && <div style={{ textAlign: "right", fontSize: 12, color: "#C0C0D8", ...mono }}>{(c.purchases ?? 0) > 0 ? c.purchases.toLocaleString("ro-RO") : "—"}</div>}
                      <div style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A" }}>{fmtObjective(c.objective)}</span>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A" }}>{fmtBid(c.bidStrategy)}</span>
                      </div>
                      {platform === "meta" && (
                        <div style={{ textAlign: "center" }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A", ...mono }}>{fmtAttribution(c.attribution)}</span>
                        </div>
                      )}
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 10, fontWeight: 500, padding: "3px 8px", borderRadius: 4, background: bs.bg, color: bs.color, whiteSpace: "nowrap" }}>{st.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
