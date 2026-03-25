import OpenAI from "openai";
import express from "express";
import { createClient } from "@supabase/supabase-js";

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";


const app = express();
dotenv.config();
app.use(express.urlencoded({ extended: false }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

/*const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});*/

//auto-detects GEMINI_API_KEY
const genAI = new GoogleGenAI({});

const parseIntent = async (message) => {
  const prompt = `
Je bent een voetbal assistent.

Geef JSON terug met:
- intent
- player_name (optioneel)
- date (optioneel)

Mogelijke intents:
- next_game
- last_game
- attendance_confirm
- attendance_decline
- top_scorer
- player_stats
- attendance_list

Message: "${message}"
`;

  /*const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });*/
  
  const rawResponse = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
	  generationConfig: {
		responseMimeType: "application/json",
		responseSchema: {
			type: "object",
			properties: {
				intent: { type: "string" },
				player_name: { type: "string" },
				date: { type: "string" }
			}
		}
	  },		
	  contents: prompt
	  });
  
 // Use regex to remove markdown code block markers
 const response = rawResponse.text.replace(/^```json\n?|```$/g, "").trim();

  return JSON.parse(response);
};

const getNextGame = async () => {
  const { data } = await supabase
    .from("games")
    .select("*")
    .gte("match_datetime", new Date().toISOString())
    .order("match_datetime", { ascending: true })
    .limit(1);

  return data?.[0];
};

const getLastGame = async () => {
  const { data } = await supabase
    .from("games")
    .select("*")
    .lt("match_datetime", new Date().toISOString())
    .order("match_datetime", { ascending: false })
    .limit(1);

  return data?.[0];
};

const getTopScorer = async () => {
  const { data } = await supabase
    .from("player_leaderboard")
    .select("*")
    .order("goals", { ascending: false })
    .limit(1);

  return data?.[0];
};

async function getPlayerByPhone(phone) {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("phone", phone)
    .single();

  if (error) {
    console.error("Player lookup error:", error);
    return null;
  }

  return data;
}

app.post("/whatsapp", async (req, res) => {
  const message = req.body.Body;
  const phone = req.body.From.replace("whatsapp:", "");

  let reply = "🤔 Ik begrijp je niet.";

  try {
    const intentData = await parseIntent(message);

    const { intent, player_name } = intentData;

    // 👉 NEXT GAME
    if (intent === "next_game") {
      const game = await getNextGame();

      reply = `⚽ Volgende match:
${game.opponent}
📅 ${new Date(game.match_datetime).toLocaleString()}
📍 ${game.location}`;
    }

    // 👉 LAST GAME
    else if (intent === "last_game") {
      const game = await getLastGame();

      reply = `📊 Laatste match:
${game.opponent}
⚽ ${game.goals_home} - ${game.goals_away}`;
    }

    // 👉 TOPSCORER
    else if (intent === "top_scorer") {
      const player = await getTopScorer();

      reply = `🏆 Topscorer:
${player.name}
⚽ ${player.goals} goals`;
    }

    // 👉 PLAYER STATS
    else if (intent === "player_stats" && player_name) {
      const { data } = await supabase
        .from("player_leaderboard")
        .select("*")
        .ilike("name", `%${player_name}%`)
        .single();

      if (data) {
        reply = `📊 ${data.name}
⚽ Goals: ${data.goals}
🎯 Assists: ${data.assists}`;
      } else {
        reply = "❌ Speler niet gevonden.";
      }
    }

    // 👉 ATTENDANCE CONFIRM
    else if (intent === "attendance_confirm") {
      const player = await getPlayerByPhone(phone);
      const game = await getNextGame();

      await supabase.from("player_attendance").upsert({
        player_id: player.id,
        game_id: game.id,
        status: "confirmed",
      });

      reply = `✅ Je bent ingeschreven voor de match!`;
    }

    // 👉 ATTENDANCE LIST
    else if (intent === "attendance_list") {
      const game = await getNextGame();

      const { data } = await supabase
        .from("player_attendance")
        .select("status, players(name)")
        .eq("game_id", game.id);

      const confirmed = data
        .filter((p) => p.status === "confirmed")
        .map((p) => p.players.name)
        .join(", ");

      reply = `👥 Aanwezig:
${confirmed}`;
    }
  } catch (err) {
    console.error(err);
    reply = "❌ AI error :" + err.message;
  }

  res.send(`
    <Response>
      <Message>${reply}</Message>
    </Response>
  `);
});

app.listen(3000);
