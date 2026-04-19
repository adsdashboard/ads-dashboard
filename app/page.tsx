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
  spend: number; revenue: number; roas: number;
  status: string; objective: string | null;
  bidStrategy: string | null; attribution: string | null;
  ads: Ad[];
};

type SortKey = "name" | "spend" | "revenue" | "roas" | "objective" | "bidStrategy" | "attribution" | "status";
type SortDir = "asc" | "desc";

function getStatus(roas: number, status: string) {
  if (status === "ACTIVE" && roas >= 5) return { label: "Scalează", cls: "scale" };
  if (status === "ACTIVE" && roas >= 4) return { label: "Monitorizare", cls: "watch" };
  if (status === "ACTIVE") return { label: "Activ", cls: "test" };
  if (roas >= 5) return { label: "Scalează", cls: "scale" };
  if (roas >= 4) return { label: "Monitorizare", cls: "watch" };
  if (roas > 0) return { label: "Oprește", cls: "pause" };
  return { label: "Fără date", cls: "none" };
}

function getRoasColor(roas: number) {
  if (roas >= 5) return "#4ADE80";
  if (roas >= 4) return "#FBB024";
  if (roas > 0) return "#F87171";
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

export default function Dashboard() {
  const [period, setPeriod] = useState("prev7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState({ totalSpend: 0, totalRevenue: 0, totalRoas: 0, eligible: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("active");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const menuRef = useRef<HTMLDivElement>(null);

  const [plannedDailyBudget, setPlannedDailyBudget] = useState<string>("");
  const [editingBudget, setEditingBudget] = useState(false);

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
    if (p === "last_month") {
      const lastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return lastMonth.getDate();
    }
    if (p.includes("|")) {
      const [since, until] = p.split("|");
      const diff = new Date(until).getTime() - new Date(since).getTime();
      return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
    }
    return 7;
  }

  const activePeriodLabel = PERIODS.find(p => p.key === period)?.label || "Personalizat";

  function getPeriodDates(p: string): string | null {
    const fmt = (d: Date) => d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" });
    const today = new Date();
    const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

    if (p.includes("|")) {
      const [since, until] = p.split("|");
      return `${since} → ${until}`;
    }
    switch (p) {
      case "today":      return fmt(today);
      case "yesterday":  return fmt(daysAgo(1));
      case "prev3":      return `${fmt(daysAgo(3))} → ${fmt(daysAgo(1))}`;
      case "prev4":      return `${fmt(daysAgo(4))} → ${fmt(daysAgo(1))}`;
      case "prev5":      return `${fmt(daysAgo(5))} → ${fmt(daysAgo(1))}`;
      case "prev7":      return `${fmt(daysAgo(7))} → ${fmt(daysAgo(1))}`;
      case "last_week": {
        const mon = new Date(today);
        mon.setDate(today.getDate() - today.getDay() - 6);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        return `${fmt(mon)} → ${fmt(sun)}`;
      }
      case "this_month": {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return `${fmt(start)} → ${fmt(today)}`;
      }
      case "last_month": {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return `${fmt(start)} → ${fmt(end)}`;
      }
      default: return null;
    }
  }

  const activePeriodDates = getPeriodDates(period);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowPeriodMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function fetchData(p: string) {
    setLoading(true); setError("");
    fetch(`/api/meta?period=${encodeURIComponent(p)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setCampaigns(data.campaigns || []);
        setSummary({ totalSpend: data.totalSpend, totalRevenue: data.totalRevenue, totalRoas: data.totalRoas, eligible: data.eligible });
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }

  useEffect(() => {
    if (!period.includes("|") && period !== "custom") fetchData(period);
  }, [period]);

  function applyCustom() {
    if (!customFrom || !customTo) return;
    const key = `${customFrom}|${customTo}`;
    setShowCustom(false); setShowPeriodMenu(false);
    setPeriod(key); fetchData(key);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = campaigns.filter(c => {
    if (filter === "active") return c.status === "ACTIVE";
    if (filter === "paused") return c.status === "PAUSED";
    return true;
  });

  const sorted = sortCampaigns(filtered, sortKey, sortDir);
  const activeCamps = campaigns.filter(c => c.status === "ACTIVE");
  const scalabile = campaigns.filter(c => c.roas >= 5);

  const COL = "minmax(0,2fr) 300px minmax(0,90px) minmax(0,100px) minmax(0,70px) minmax(0,110px) minmax(0,110px) minmax(0,100px) minmax(0,100px)";
  const mono = { fontFamily: "'DM Mono', monospace" } as const;

  function ColHeader({ label, k, align = "right" }: { label: string; k: SortKey; align?: string }) {
    return (
      <div
        onClick={() => handleSort(k)}
        style={{ textAlign: align as any, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start", gap: 2 }}
      >
        <span style={{ color: sortKey === k ? "#A5B4FC" : "#4A4A6A" }}>{label}</span>
        <SortIcon active={sortKey === k} dir={sortDir} />
      </div>
    );
  }

  return (
    <main style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#0A0A0F", color: "#E8E8F0", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1E1E2E", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>A</div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Ads Dashboard</span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#0F3D2E", color: "#4ADE80", border: "1px solid #1D9E7530" }}>● Live Meta</span>
        </div>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button onClick={() => setShowPeriodMenu(v => !v)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #2A2A4A", background: "#0F0F1A", color: "#A5B4FC", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📅</span>
            <span>{activePeriodLabel}</span>
            {activePeriodDates && (
              <span style={{ color: "#6B6B8A", fontSize: 11, borderLeft: "1px solid #2A2A4A", paddingLeft: 8 }}>{activePeriodDates}</span>
            )}
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
                <button onClick={() => setShowCustom(v => !v)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", borderRadius: 6, border: "none", background: "transparent", color: "#9090B0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  Personalizat ▸
                </button>
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
        {loading && <div style={{ textAlign: "center", padding: "60px 0", color: "#6B6B8A", fontSize: 13 }}>Se încarcă datele din Meta...</div>}
        {error && <div style={{ padding: "12px 16px", background: "#3D0F0F", border: "1px solid #F8717130", borderRadius: 8, color: "#F87171", fontSize: 12, marginBottom: 16 }}>Eroare: {error}</div>}

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

            {/* Daily budget cards */}
            {(() => {
              const days = getPeriodDays(period);
              const dailyReal = days > 0 ? Math.round(summary.totalSpend / days) : 0;
              const planned = parseInt(plannedDailyBudget) || 0;
              const diff = dailyReal - planned;
              const diffColor = diff > 0 ? "#4ADE80" : diff < 0 ? "#F87171" : "#6B6B8A";
              const diffLabel = diff > 0 ? `+${diff.toLocaleString("ro-RO")} lei peste plan` : diff < 0 ? `${diff.toLocaleString("ro-RO")} lei sub plan` : "conform planului";
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {/* Real daily budget */}
                  <div style={{ background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#6B6B8A", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Buget mediu zilnic real <span style={{ color: "#3A3A5C" }}>({days} {days === 1 ? "zi" : "zile"})</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: "#E8E8F0", fontFamily: "'DM Mono', monospace" }}>
                        {dailyReal.toLocaleString("ro-RO")} lei
                      </div>
                      {planned > 0 && (
                        <div style={{ fontSize: 11, color: diffColor, fontFamily: "'DM Mono', monospace" }}>{diffLabel}</div>
                      )}
                    </div>
                  </div>

                  {/* Planned daily budget — editable */}
                  <div style={{ background: "#0F0F1A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "12px 14px", cursor: "pointer" }} onClick={() => setEditingBudget(true)}>
                    <div style={{ fontSize: 10, color: "#6B6B8A", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Buget mediu zilnic planificat <span style={{ color: "#6366f1", fontSize: 9 }}>✎ editabil</span>
                    </div>
                    {editingBudget ? (
                      <input
                        autoFocus
                        type="number"
                        value={plannedDailyBudget}
                        onChange={e => setPlannedDailyBudget(e.target.value)}
                        onBlur={() => setEditingBudget(false)}
                        onKeyDown={e => e.key === "Enter" && setEditingBudget(false)}
                        placeholder="ex: 1500"
                        style={{ background: "transparent", border: "none", borderBottom: "1px solid #6366f1", color: "#E8E8F0", fontSize: 18, fontWeight: 600, fontFamily: "'DM Mono', monospace", outline: "none", width: "100%", padding: "0 0 2px 0" }}
                      />
                    ) : (
                      <div style={{ fontSize: 18, fontWeight: 600, color: plannedDailyBudget ? "#A5B4FC" : "#2A2A4A", fontFamily: "'DM Mono', monospace" }}>
                        {plannedDailyBudget ? `${parseInt(plannedDailyBudget).toLocaleString("ro-RO")} lei` : "click pentru a seta..."}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

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
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: COL, gap: 8, padding: "0 10px 7px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 1200 }}>
                <ColHeader label="Campanie" k="name" align="left" />
                <div style={{ color: "#4A4A6A" }}>Top 5 creative</div>
                <ColHeader label="Cheltuit" k="spend" align="right" />
                <ColHeader label="Venituri" k="revenue" align="right" />
                <ColHeader label="ROAS" k="roas" align="right" />
                <ColHeader label="Obiectiv" k="objective" align="center" />
                <ColHeader label="Bid strategy" k="bidStrategy" align="center" />
                <ColHeader label="Attribution" k="attribution" align="center" />
                <ColHeader label="Status" k="status" align="right" />
              </div>

              {/* Rows */}
              <div style={{ minWidth: 1200 }}>
                {sorted.map(c => {
                  const st = getStatus(c.roas, c.status);
                  const bs = badgeStyle(st.cls);
                  const thumbSlots = Array.from({ length: 5 }, (_, i) => c.ads[i] || null);
                  return (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: COL, gap: 8, padding: "8px 10px", background: "#0D0D1A", border: "1px solid #16162A", borderRadius: 7, marginBottom: 3, alignItems: "center", minWidth: 1200 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 12, color: "#D0D0E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</div>
                        <div style={{ fontSize: 10, color: "#4A4A6A", marginTop: 1 }}>{c.sub}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {thumbSlots.map((ad, i) => ad ? <AdThumb key={ad.id} ad={ad} /> : <EmptyThumb key={i} />)}
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "#C0C0D8", ...mono }}>{c.spend > 0 ? c.spend.toLocaleString("ro-RO") + " L" : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "#C0C0D8", ...mono }}>{c.revenue > 0 ? c.revenue.toLocaleString("ro-RO") + " L" : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: getRoasColor(c.roas), ...mono }}>{c.roas > 0 ? c.roas + "x" : "—"}</div>
                      <div style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A" }}>{fmtObjective(c.objective)}</span>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A" }}>{fmtBid(c.bidStrategy)}</span>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#12122A", color: "#7070A0", border: "1px solid #1E1E3A", ...mono }}>{fmtAttribution(c.attribution)}</span>
                      </div>
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
