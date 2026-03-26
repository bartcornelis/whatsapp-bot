import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenAI({});

// ---------- AI INTENT ----------
async function parseIntent(message) {
  const prompt = `
Je bent een slimme voetbal team assistent.

Analyseer het bericht en geef JSON:

{
  "intent": "...",
  "confidence": 0-1,
  "data": {
    "goals": number,
    "assists": number
  }
}

Mogelijke intents:
- next_game
- last_game
- attendance_confirm
- attendance_decline
- attendance_list
- top_scorer
- assists
- player_stats
- add_stats

Voorbeelden:
"ik kom" → attendance_confirm
"ik kan niet" → attendance_decline
"wie speelt mee" → attendance_list
"ik scoorde 2 goals" → add_stats + goals:2
"ik gaf 1 assist" → add_stats + assists:1

Message: "${message}"
`;

  try {
    const res = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = res.text || "";

    const clean = text.replace(/^```json\n?|```$/g, "").trim();

    return JSON.parse(clean);
  } catch (err) {
    console.error("AI ERROR:", err);
    return { intent: "unknown", confidence: 0 };
  }
}

// ---------- HELPERS ----------
async function getNextGame() {
  const { data } = await supabase
    .from("games")
    .select("*")
    .gte("match_datetime", new Date().toISOString())
    .order("match_datetime", { ascending: true })
    .limit(1);

  return data?.[0];
}

async function getLastGame() {
  const { data } = await supabase
    .from("games")
    .select("*")
    .lt("match_datetime", new Date().toISOString())
    .order("match_datetime", { ascending: false })
    .limit(1);

  return data?.[0];
}

async function getTopScorer() {
  const { data } = await supabase
    .from("player_leaderboard")
    .select("*")
    .order("goals", { ascending: false })
    .limit(1);

  return data?.[0];
}

async function getTopAssists() {
  const { data } = await supabase
    .from("player_leaderboard")
    .select("*")
    .order("assists", { ascending: false })
    .limit(1);

  return data?.[0];
}

async function getPlayerByPhone(phone) {
  const { data } = await supabase
    .from("players")
    .select("*")
    .eq("phone", phone);

  if (!data || data.length === 0) return null;

  return data[0];
}

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const message = body?.Body;
    const phone = body?.From?.replace("whatsapp:", "");
	
	const isReplyToBot = body.Context?.From === process.env.TWILIO_NUMBER;

    console.log("Incoming:", message, phone);

    if (!message) {
      return res.status(400).send("No message");
    }
	
	const isMentioned =
		message.toLowerCase().includes("bot") ||
		message.toLowerCase().includes("franky") ||
		message.toLowerCase().includes("coach");
		
	const triggerWords = [
		"match",
		"wedstrijd",
		"aanwezig",
		"kom",
		"wie speelt",
		"topscorer",
		"score",
	];

	const isRelevant = triggerWords.some(word =>
		message.toLowerCase().includes(word)
	);

	// 👉 STOP HIER als geen mention
	if (!isMentioned && !isRelevant) {
		return res.status(200).send(""); // geen reply
	}

    let reply = "🤔 Ik begrijp je niet.";

    const { intent, data } = await parseIntent(message);

	// speler ophalen
	const player = await getPlayerByPhone(phone);

	// fallback
	if (!intent || intent === "unknown") {
		return res.send(`
			<Response><Message>🤔 Ik begrijp je niet helemaal.</Message></Response>
		`);
	}

    // ---------- NEXT GAME ----------
    if (intent === "next_game") {
      const game = await getNextGame();

      if (game) {
        reply = `⚽ Volgende match:
${game.opponent}
📅 ${new Date(game.match_datetime).toLocaleString()}
📍 ${game.location}`;
      }
    }

    // ---------- LAST GAME ----------
    else if (intent === "last_game") {
      const game = await getLastGame();

      if (game) {
        reply = `📊 Laatste match:
${game.opponent}
⚽ ${game.goals_home} - ${game.goals_away}`;
      }
    }

    // ---------- TOP SCORER ----------
    else if (intent === "top_scorer") {
      const player = await getTopScorer();

      if (player) {
        reply = `🏆 Topscorer:
${player.name}
⚽ ${player.goals} goals`;
      }
    }
	
	// ---------- TOP ASSISTS ----------
    else if (intent === "assists") {
      const player = await getTopAssists();

      if (player) {
        reply = `🏆 Topassists:
${player.name}
⚽ ${player.assists} assists`;
      }
    }

    // ---------- PLAYER STATS ----------
    else if (intent === "player_stats" && player_name) {
      const { data } = await supabase
        .from("player_leaderboard")
        .select("*")
        .ilike("name", `%${player_name}%`);

      if (data && data.length > 0) {
        const p = data[0];

        reply = `📊 ${p.name}
⚽ Goals: ${p.goals}
🎯 Assists: ${p.assists}`;
      } else {
        reply = "❌ Speler niet gevonden.";
      }
    }

    else if (intent === "attendance_confirm") {
		const game = await getNextGame();

		await supabase.from("player_attendance").upsert({
			player_id: player.id,
			game_id: game.id,
			status: "confirmed",
		});

		reply = "✅ Je bent ingeschreven!";
	}

	else if (intent === "attendance_decline") {
		const game = await getNextGame();

		await supabase.from("player_attendance").upsert({
			player_id: player.id,
			game_id: game.id,
			status: "declined",
		});

		reply = "❌ Je bent afgemeld.";
	}

    // ---------- ATTENDANCE LIST ----------
    else if (intent === "attendance_list") {
      const game = await getNextGame();

      if (!game) {
        reply = "❌ Geen match.";
      } else {
        const { data } = await supabase
          .from("player_attendance")
          .select("status, players(name)")
          .eq("game_id", game.id);

        const confirmed = data
          ?.filter((p) => p.status === "confirmed")
          .map((p) => p.players.name)
          .join(", ");

        reply = `👥 Aanwezig:
${confirmed || "niemand"}`;
      }
    }

    // ---------- RESPONSE ----------
    return res.status(200).send(`
<Response>
  <Message>${reply}</Message>
</Response>
`);

  } catch (err) {
    console.error("FATAL ERROR:", err);

    return res.status(500).send(`
<Response>
  <Message>❌ Server error</Message>
</Response>
`);
  }
}

//app.listen(3000);