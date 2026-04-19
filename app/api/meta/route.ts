import { NextResponse } from "next/server";

const AD_ACCOUNT_ID = process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function getDateParams(period: string): Record<string, string> {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

  switch (period) {
    case "today":       return { date_preset: "today" };
    case "yesterday":   return { date_preset: "yesterday" };
    case "prev3":       return { time_range: JSON.stringify({ since: fmt(daysAgo(3)), until: fmt(daysAgo(1)) }) };
    case "prev4":       return { time_range: JSON.stringify({ since: fmt(daysAgo(4)), until: fmt(daysAgo(1)) }) };
    case "prev5":       return { time_range: JSON.stringify({ since: fmt(daysAgo(5)), until: fmt(daysAgo(1)) }) };
    case "prev7":       return { time_range: JSON.stringify({ since: fmt(daysAgo(7)), until: fmt(daysAgo(1)) }) };
    case "last_week":   return { date_preset: "last_week_mon_sun" };
    case "this_month":  return { date_preset: "this_month" };
    case "last_month":  return { date_preset: "last_month" };
    default:
      if (period.includes("|")) {
        const [since, until] = period.split("|");
        return { time_range: JSON.stringify({ since, until }) };
      }
      return { time_range: JSON.stringify({ since: fmt(daysAgo(7)), until: fmt(daysAgo(1)) }) };
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
          // thumbnail_url si object_story_id in cereri separate ca sa nu se interfereze
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
