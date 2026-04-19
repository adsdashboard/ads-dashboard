import { NextResponse } from "next/server";

const AD_ACCOUNT_ID = process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function getDates(period: string): { since: string; until: string } {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Bucharest" }));
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const ago = (n: number) => { const d = new Date(now); d.setDate(d.getDate()-n); return d; };

  switch (period) {
    case "today":      return { since: fmt(now), until: fmt(now) };
    case "yesterday":  return { since: fmt(ago(1)), until: fmt(ago(1)) };
    case "prev3":      return { since: fmt(ago(3)), until: fmt(ago(1)) };
    case "prev4":      return { since: fmt(ago(4)), until: fmt(ago(1)) };
    case "prev5":      return { since: fmt(ago(5)), until: fmt(ago(1)) };
    case "prev7":      return { since: fmt(ago(7)), until: fmt(ago(1)) };
    case "last_week": {
      const day = now.getDay();
      const diffMon = day === 0 ? 6 : day - 1;
      return { since: fmt(ago(diffMon + 7)), until: fmt(ago(diffMon + 1)) };
    }
    case "this_month": return { since: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmt(now) };
    case "last_month": return {
      since: fmt(new Date(now.getFullYear(), now.getMonth()-1, 1)),
      until: fmt(new Date(now.getFullYear(), now.getMonth(), 0))
    };
    default:
      if (period.includes("|")) { const [s,u] = period.split("|"); return { since: s, until: u }; }
      return { since: fmt(ago(7)), until: fmt(ago(1)) };
  }
}

function buildPostUrl(objectStoryId: string | null, adId: string): string {
  if (objectStoryId) {
    const parts = objectStoryId.split("_");
    if (parts.length === 2) return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
  }
  return `https://www.facebook.com/ads/library/?id=${adId}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "prev7";
  const { since, until } = getDates(period);
  const timeRange = JSON.stringify({ since, until });

  try {
    // Fetch campaigns — use filtering param to get only campaigns with spend in period
    const campsUrl = new URL(`https://graph.facebook.com/v19.0/act_${AD_ACCOUNT_ID}/campaigns`);
    campsUrl.searchParams.set("fields", "id,name,status,objective,bid_strategy");
    campsUrl.searchParams.set("access_token", ACCESS_TOKEN!);
    campsUrl.searchParams.set("limit", "50");
    // filtering ensures we only get campaigns active in the period
    campsUrl.searchParams.set("filtering", JSON.stringify([{ field: "campaign.delivery_info", operator: "IN", value: ["active", "inactive", "paused", "completed"] }]));
    const campsRes = await fetch(campsUrl.toString());
    const campsData = await campsRes.json();

    if (campsData.error) {
      return NextResponse.json({ error: campsData.error.message }, { status: 400 });
    }

    // Fetch insights separately with explicit time_range
    const insightsUrl = new URL(`https://graph.facebook.com/v19.0/act_${AD_ACCOUNT_ID}/insights`);
    insightsUrl.searchParams.set("fields", "campaign_id,spend,purchase_roas,attribution_setting");
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("time_range", timeRange);
    insightsUrl.searchParams.set("access_token", ACCESS_TOKEN!);
    insightsUrl.searchParams.set("limit", "100");
    const insightsRes = await fetch(insightsUrl.toString());
    const insightsData = await insightsRes.json();

    if (insightsData.error) {
      return NextResponse.json({ error: insightsData.error.message }, { status: 400 });
    }

    // Build insights map by campaign_id
    const insightsMap: Record<string, any> = {};
    for (const row of insightsData.data || []) {
      insightsMap[row.campaign_id] = row;
    }

    // Fetch ads with thumbnails for campaigns that have spend
    const campaigns = await Promise.all(
      (campsData.data || []).map(async (c: any) => {
        const ins = insightsMap[c.id];
        const spend = parseFloat(ins?.spend || "0");
        const roasArr = ins?.purchase_roas;
        const roas = roasArr ? parseFloat(roasArr[0]?.value || "0") : 0;
        const revenue = spend * roas;
        const attribution = ins?.attribution_setting || null;

        let ads: any[] = [];
        try {
          // Only fetch ads for campaigns with spend > 0
          if (spend > 0) {
            const adsUrl = new URL(`https://graph.facebook.com/v19.0/${c.id}/ads`);
            adsUrl.searchParams.set("fields", "id,name,creative{thumbnail_url,image_url,object_story_id},insights{spend,purchase_roas}");
            adsUrl.searchParams.set("access_token", ACCESS_TOKEN!);
            adsUrl.searchParams.set("limit", "10");
            adsUrl.searchParams.set("time_range", timeRange);
            const adsRes = await fetch(adsUrl.toString());
            const adsData = await adsRes.json();

            ads = (adsData.data || [])
              .map((ad: any) => {
                const ai = ad.insights?.data?.[0];
                const adSpend = parseFloat(ai?.spend || "0");
                const adRoasArr = ai?.purchase_roas;
                const adRoas = adRoasArr ? parseFloat(adRoasArr[0]?.value || "0") : 0;
                return {
                  id: ad.id,
                  name: ad.name,
                  spend: Math.round(adSpend),
                  roas: Math.round(adRoas * 10) / 10,
                  thumbnail: ad.creative?.thumbnail_url || ad.creative?.image_url || null,
                  permalink: buildPostUrl(ad.creative?.object_story_id || null, ad.id),
                };
              })
              .sort((a: any, b: any) => b.spend - a.spend)
              .slice(0, 5);
          }
        } catch { /* skip */ }

        return {
          id: c.id,
          name: c.name,
          sub: `Meta · ${c.status}`,
          spend: Math.round(spend),
          revenue: Math.round(revenue),
          roas: Math.round(roas * 10) / 10,
          status: c.status,
          objective: c.objective || null,
          bidStrategy: c.bid_strategy || null,
          attribution,
          ads,
        };
      })
    );

    // Only include campaigns with spend > 0 in period OR active campaigns
    const relevantCampaigns = campaigns.filter(c => c.spend > 0 || c.status === "ACTIVE");

    const totalSpend = relevantCampaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = relevantCampaigns.reduce((s, c) => s + c.revenue, 0);
    const totalRoas = totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 10) / 10 : 0;
    const eligible = relevantCampaigns.filter(c => c.roas >= 5).length;

    return NextResponse.json({ campaigns: relevantCampaigns, totalSpend, totalRevenue, totalRoas, eligible });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
