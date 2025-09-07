import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function setWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const urlBase = process.env.PUBLIC_URL;

  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN missing in env");
    process.exit(1);
  }
  if (!urlBase) {
    console.error(
      "❌ PUBLIC_URL missing in env (set your HTTPS URL, e.g. ngrok)."
    );
    process.exit(1);
  }

  const webhookUrl = `${urlBase}/bot${token}`;

  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        params: { url: webhookUrl },
      }
    );
    console.log("✅ setWebhook response:", res.data);
  } catch (err) {
    console.error("❌ setWebhook failed:", err.response?.data || err.message);
  }
}

setWebhook();
