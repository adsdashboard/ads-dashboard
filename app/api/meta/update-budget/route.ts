import { NextResponse } from "next/server";

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const BASE_URL = "https://graph.facebook.com/v19.0";

function calcSuggestion(roas: number, ageInDays: number) {
  const basePercent = roas > 8 ? 25 : roas >= 6 ? 20 : 15;

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
  return { basePercent, finalPercent, ageNote };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  const roas = parseFloat(searchParams.get("roas") || "0");

  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  try {
    const url = new URL(`${BASE_URL}/${campaignId}`);
    url.searchParams.set("fields", "daily_budget,created_time,name");
    url.searchParams.set("access_token", ACCESS_TOKEN!);

    const res: Response = await fetch(url.toString());
    const data = await res.json();

    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });

    const dailyBudgetCents = parseInt(data.daily_budget || "0", 10);
    const hasBudget = dailyBudgetCents > 0;
    const dailyBudget = dailyBudgetCents / 100;

    const createdTime = data.created_time ? new Date(data.created_time) : new Date();
    const ageInDays = Math.floor((Date.now() - createdTime.getTime()) / (1000 * 60 * 60 * 24));

    const { basePercent, finalPercent, ageNote } = calcSuggestion(roas, ageInDays);

    const suggestedBudget = hasBudget ? Math.round(dailyBudget * (1 + finalPercent / 100)) : null;

    const roasNote = roas > 8
      ? `ROAS ${roas}x excepțional → bază +${basePercent}%`
      : roas >= 6
      ? `ROAS ${roas}x foarte bun → bază +${basePercent}%`
      : `ROAS ${roas}x bun → bază +${basePercent}%`;

    return NextResponse.json({ dailyBudget: hasBudget ? dailyBudget : null, suggestedBudget, finalPercent, roasNote, ageNote, ageInDays, hasBudget });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { campaignId, newBudget } = await request.json();
    if (!campaignId || !newBudget) return NextResponse.json({ error: "Missing campaignId or newBudget" }, { status: 400 });

    const newBudgetCents = Math.round(parseFloat(newBudget) * 100);

    const res: Response = await fetch(`${BASE_URL}/${campaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: ACCESS_TOKEN!, daily_budget: String(newBudgetCents) }),
    });
    const data = await res.json();

    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
