import { NextResponse } from "next/server";

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");

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

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "prev7";
  const { since, until } = getDates(period);

  try {
    const accessToken = await getAccessToken();

    // Google Ads Query Language (GAQL)
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.conversions_value,
        metrics.roas
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `;

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${CUSTOMER_ID}/googleAds:search`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message || JSON.stringify(data.error) }, { status: 400 });
    }

    const campaigns = (data.results || []).map((row: any) => {
      const spend = Math.round((row.metrics?.cost_micros || 0) / 1_000_000);
      const revenue = Math.round(row.metrics?.conversions_value || 0);
      const roas = spend > 0 ? Math.round((revenue / spend) * 10) / 10 : 0;

      const bidMap: Record<string, string> = {
        TARGET_ROAS: "Target ROAS",
        TARGET_CPA: "Target CPA",
        MAXIMIZE_CONVERSIONS: "Max conversions",
        MAXIMIZE_CONVERSION_VALUE: "Max conv. value",
        MANUAL_CPC: "Manual CPC",
        ENHANCED_CPC: "Enhanced CPC",
      };

      const channelMap: Record<string, string> = {
        SEARCH: "Search",
        DISPLAY: "Display",
        SHOPPING: "Shopping",
        VIDEO: "Video",
        PERFORMANCE_MAX: "Performance Max",
      };

      return {
        id: row.campaign?.id,
        name: row.campaign?.name,
        sub: `Google · ${row.campaign?.status}`,
        spend,
        revenue,
        roas,
        status: row.campaign?.status,
        objective: channelMap[row.campaign?.advertising_channel_type] || row.campaign?.advertising_channel_type || null,
        bidStrategy: bidMap[row.campaign?.bidding_strategy_type] || row.campaign?.bidding_strategy_type || null,
        attribution: null,
        ads: [],
        platform: "google",
      };
    });

    const totalSpend = campaigns.reduce((s: number, c: any) => s + c.spend, 0);
    const totalRevenue = campaigns.reduce((s: number, c: any) => s + c.revenue, 0);
    const totalRoas = totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 10) / 10 : 0;
    const eligible = campaigns.filter((c: any) => c.roas >= 5).length;

    return NextResponse.json({ campaigns, totalSpend, totalRevenue, totalRoas, eligible });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}