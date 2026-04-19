import { NextResponse } from "next/server";

const AD_ACCOUNT_ID = process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID;
const ACCESS_TOKEN  = process.env.META_ACCESS_TOKEN;
const PAGE_ID       = process.env.META_PAGE_ID;
const PIXEL_ID      = process.env.META_PIXEL_ID;
const BASE          = "https://graph.facebook.com/v19.0";

function parsePostId(link: string): string | null {
  const s = link.trim();
  if (/^\d+$/.test(s)) return s;
  const patterns = [
    /\/posts\/(\d+)/,
    /[?&]fbid=(\d+)/,
    /story_fbid=(\d+)/,
    /\/reel\/(\d+)/,
    /\/photo\/(\d+)/,
    /\/videos\/(\d+)/,
    /\/permalink\/(\d+)/,
    /[?&]v=(\d+)/,
    /\/(\d{10,})\/?(?:\?|$)/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

function fmtDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getFullYear()).slice(-2)}`;
}

async function apiPost(path: string, params: Record<string, string>): Promise<any> {
  const res: Response = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: ACCESS_TOKEN!, ...params }),
  });
  return res.json();
}

async function deleteCampaign(campaignId: string) {
  try {
    await fetch(`${BASE}/${campaignId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: ACCESS_TOKEN! }),
    });
  } catch { /* best-effort */ }
}

export async function POST(request: Request) {
  try {
    const { postLink, creativeName, category, landingUrl, dailyBudget } = await request.json();

    if (!postLink || !creativeName || !category || !landingUrl) {
      return NextResponse.json({ error: "Câmpuri obligatorii lipsă." }, { status: 400 });
    }
    if (!PAGE_ID)  return NextResponse.json({ error: "META_PAGE_ID nesetat în environment." }, { status: 500 });
    if (!PIXEL_ID) return NextResponse.json({ error: "META_PIXEL_ID nesetat în environment." }, { status: 500 });

    if (postLink.includes("instagram.com")) {
      return NextResponse.json({ error: "Pentru postări Instagram folosește linkul postării de pe Facebook (cross-postat) sau linkul din Meta Ads Library." }, { status: 400 });
    }

    const postId = parsePostId(postLink);
    if (!postId) return NextResponse.json({ error: "Nu s-a putut extrage ID-ul postării. Verifică linkul." }, { status: 400 });

    const objectStoryId = `${PAGE_ID}_${postId}`;
    const campaignName  = `[CT] LS / ${category} / ${creativeName} / Auto / NO / HP / ${fmtDate()}`;
    const budgetCents   = String(Math.round((parseFloat(String(dailyBudget)) || 100) * 100));

    // 1. Campanie
    const campData = await apiPost(`act_${AD_ACCOUNT_ID}/campaigns`, {
      name: campaignName,
      objective: "OUTCOME_SALES",
      status: "ACTIVE",
      special_ad_categories: "[]",
    });
    if (campData.error) return NextResponse.json({ error: `Campanie: ${campData.error.message}` }, { status: 400 });
    const campaignId = campData.id as string;

    // 2. Ad set — România Broad, Advantage+ audience, ABO fix
    const adsetData = await apiPost(`act_${AD_ACCOUNT_ID}/adsets`, {
      name: `[CT] ${creativeName} / RO Broad A+`,
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      daily_budget: budgetCents,
      targeting: JSON.stringify({ geo_locations: { countries: ["RO"] }, age_min: 18 }),
      "targeting_automation[advantage_audience]": "1",
      promoted_object: JSON.stringify({ pixel_id: PIXEL_ID, custom_event_type: "PURCHASE" }),
      attribution_spec: JSON.stringify([
        { event_type: "CLICK_THROUGH", window_days: 7 },
        { event_type: "VIEW_THROUGH",  window_days: 1 },
      ]),
      status: "ACTIVE",
    });
    if (adsetData.error) {
      await deleteCampaign(campaignId);
      return NextResponse.json({ error: `Ad Set: ${adsetData.error.message}` }, { status: 400 });
    }
    const adsetId = adsetData.id as string;

    // 3. Creativ din postare existentă
    const creativeData = await apiPost(`act_${AD_ACCOUNT_ID}/adcreatives`, {
      name: creativeName,
      object_story_id: objectStoryId,
      call_to_action: JSON.stringify({ type: "SHOP_NOW", value: { link: landingUrl } }),
    });
    if (creativeData.error) {
      await deleteCampaign(campaignId);
      return NextResponse.json({ error: `Creativ: ${creativeData.error.message}` }, { status: 400 });
    }
    const creativeId = creativeData.id as string;

    // 4. Ad
    const adData = await apiPost(`act_${AD_ACCOUNT_ID}/ads`, {
      name: creativeName,
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "ACTIVE",
    });
    if (adData.error) {
      await deleteCampaign(campaignId);
      return NextResponse.json({ error: `Ad: ${adData.error.message}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, campaignId, campaignName, adsetId, adId: adData.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
