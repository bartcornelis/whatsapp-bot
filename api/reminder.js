import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    const now = new Date();

	// 🎯 target = binnen 3 dagen
	const start = new Date();
	start.setDate(now.getDate() + 3);
	start.setHours(0, 0, 0, 0);

	const end = new Date(start);
	end.setHours(23, 59, 59, 999);

	// 📅 wedstrijden exact over 3 dagen
	const { data: games } = await supabase
  .from("games")
  .select("*")
  .gte("match_datetime", start.toISOString())
  .lte("match_datetime", end.toISOString());

    if (!games || games.length === 0) {
      return res.status(200).send("No games");
    }

    for (const game of games) {
      // 👥 spelers ophalen
      const { data: players } = await supabase
        .from("players")
        .select("*");

      for (const player of players) {
        await fetch("https://api.twilio.com/2010-04-01/Accounts/" + process.env.TWILIO_SID + "/Messages.json", {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                process.env.TWILIO_SID + ":" + process.env.TWILIO_AUTH_TOKEN
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: "whatsapp:" + process.env.TWILIO_NUMBER,
            To: "whatsapp:" + player.phone,
            Body: `⏰ Morgen match!
⚽ ${game.opponent}
📍 ${game.location}
📅 ${new Date(game.match_datetime).toLocaleString()}

Antwoord met:
"ik kom" of "ik kan niet"`,
          }),
        });
      }
    }

    return res.status(200).send("Reminders sent");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error");
  }
}