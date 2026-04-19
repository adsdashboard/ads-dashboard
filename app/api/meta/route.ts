import { NextResponse } from "next/server";

const AD_ACCOUNT_ID = process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function getDateParams(period: string): Record<string, string> {
  const now = new Date();
  // Use Bucharest timezone offset (UTC+3 in summer, UTC+2 in winter)
  const bucharest = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Bucharest" }));
  
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const today = fmt(bucharest);
  
  const daysAgo = (n: number) => {
    const d = new Date(bucharest);
    d.setDate(d.getDate() - n);
    return fmt(d);
  };

  // Always use explicit time_range — never date_preset which can be inconsistent
  switch (period) {
    case "today":
      return { time_range: JSON.stringify({ since: today, until: today }) };
    case "yesterday":
      return { time_range: JSON.stringify({ since: daysAgo(1), until: daysAgo(1) }) };
    case "prev3":
      return { time_range: JSON.stringify({ since: daysAgo(3), until: daysAgo(1) }) };
    case "prev4":
      return { time_range: JSON.stringify({ since: daysAgo(4), until: daysAgo(1) }) };
    case "prev5":
      return { time_range: JSON.stringify({ since: daysAgo(5), until: daysAgo(1) }) };
    case "prev7":
      return { time_range: JSON.stringify({ since: daysAgo(7), until: daysAgo(1) }) };
    case "last_week": {
      // Monday to Sunday of last week
      const day = bucharest.getDay(); // 0=Sun, 1=Mon...
      const diffToLastMon = day === 0 ? 6 : day - 1 + 7;
      const lastMon = daysAgo(diffToLastMon);
      const lastSun = daysAgo(diffToLastMon - 6);
      return { time_range: JSON.stringify({ since: lastMon, until: lastSun }) };
    }
    case "this_month": {
      const firstDay = new Date(bucharest.getFullYear(), bucharest.getMonth(), 1);
      return { time_range: JSON.stringify({ since: fmt(firstDay), until: today }) };
    }
    case "last_month": {
      const firstDay = new Date(bucharest.getFullYear(), bucharest.getMonth() - 1, 1);
      const lastDay = new Date(bucharest.getFullYear(), bucharest.getMonth(), 0);
      return { time_range: JSON.stringify({ since: fmt(firstDay), until: fmt(lastDay) }) };
    }
    default:
      if (period.includes("|")) {
        const [since, until] = period.split("|");
        return { time_range: JSON.stringify({ since, until }) };
      }
      return { time_range: JSON.stringify({ since: daysAgo(7), until: daysAgo(1) }) };
  }
}

function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function buildPostUrl(objectStoryId: string | null, adId: string): string {
  if (objectStoryId) {
    const parts = objectStoryId.split("_");
    if (parts.length === 2) {
      const [pageId, postId] = parts;
      return `https://www.facebook.com/${pageId}/posts/${postId}`;
    }
  }
  return `https://www.facebook.com/ads/library/?id=${adId}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "prev7";
  const dateParams = getDateParams(period);

  try {
    const campsUrl = buildUrl(`https://graph.facebook.com/v19.0/act_${AD_ACCOUNT_ID}/campaigns`, {
      fields: "id,name,status,objective,bid_strategy,insights{spend,purchase_roas,attribution_setting}",
      access_token: ACCESS_TOKEN!,
      limit: "50",
      ...dateParams,
    });

    const campsRes = await fetch(campsUrl);
    const campsData = await campsRes.json();

    if (campsData.error) {
      return NextResponse.json({ error: campsData.error.message }, { status: 400 });
    }

    const campaigns = await Promise.all(
      (campsData.data || []).map(async (c: any) => {
        const insights = c.insights?.data?.[0];
        const spend = parseFloat(insights?.spend || "0");
        const roasArr = insights?.purchase_roas;
        const roas = roasArr ? parseFloat(roasArr[0]?.value || "0") : 0;
        const revenue = spend * roas;
        const attribution = insights?.attribution_setting || null;

        let ads: any[] = [];
        try {
          const adsUrl = buildUrl(`https://graph.facebook.com/v19.0/${c.id}/ads`, {
            fields: "id,name,creative{thumbnail_url,image_url,object_story_id},insights{spend,purchase_roas}",
            access_token: ACCESS_TOKEN!,
            limit: "10",
            ...dateParams,
          });
          const adsRes = await fetch(adsUrl);
          const adsData = await adsRes.json();

          ads = (adsData.data || [])
            .map((ad: any) => {
              const ai = ad.insights?.data?.[0];
              const adSpend = parseFloat(ai?.spend || "0");
              const adRoasArr = ai?.purchase_roas;
              const adRoas = adRoasArr ? parseFloat(adRoasArr[0]?.value || "0") : 0;
              const objectStoryId = ad.creative?.object_story_id || null;
              return {
                id: ad.id,
                name: ad.name,
                spend: Math.round(adSpend),
                roas: Math.round(adRoas * 10) / 10,
                thumbnail: ad.creative?.thumbnail_url || ad.creative?.image_url || null,
                permalink: buildPostUrl(objectStoryId, ad.id),
              };
            })
            .sort((a: any, b: any) => b.spend - a.spend)
            .slice(0, 5);
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

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);
    const totalRoas = totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 10) / 10 : 0;
    const eligible = campaigns.filter(c => c.roas >= 5).length;

    return NextResponse.json({ campaigns, totalSpend, totalRevenue, totalRoas, eligible });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
