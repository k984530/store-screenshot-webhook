import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const CONFIG_DIR = path.join(os.homedir(), ".store-screenshot-mcp");
const SUBSCRIBERS_FILE = path.join(CONFIG_DIR, "subscribers.json");

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Load subscribers
function loadSubscribers(): string[] {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf-8"));
      return data.emails || [];
    }
  } catch (error) {
    console.error("Error loading subscribers:", error);
  }
  return [];
}

// Save subscribers
function saveSubscribers(emails: string[]): void {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify({ emails }, null, 2));
}

// Add subscriber
function addSubscriber(email: string): boolean {
  const subscribers = loadSubscribers();
  const normalizedEmail = email.toLowerCase().trim();

  if (!subscribers.includes(normalizedEmail)) {
    subscribers.push(normalizedEmail);
    saveSubscribers(subscribers);
    console.log(`✅ Added subscriber: ${normalizedEmail}`);
    return true;
  }
  console.log(`ℹ️ Already subscribed: ${normalizedEmail}`);
  return false;
}

// Remove subscriber
function removeSubscriber(email: string): boolean {
  const subscribers = loadSubscribers();
  const normalizedEmail = email.toLowerCase().trim();
  const index = subscribers.indexOf(normalizedEmail);

  if (index > -1) {
    subscribers.splice(index, 1);
    saveSubscribers(subscribers);
    console.log(`❌ Removed subscriber: ${normalizedEmail}`);
    return true;
  }
  return false;
}

// Gumroad Ping Webhook endpoint
app.post("/webhook/gumroad", (req, res) => {
  console.log("📨 Received Gumroad Ping:", JSON.stringify(req.body, null, 2));

  const {
    email,
    seller_id,
    product_id,
    product_permalink,
    subscription_id,
    refunded,
    subscription_cancelled_at,
    subscription_ended_at,
  } = req.body;

  // Verify seller_id (optional security check)
  const expectedSellerId = process.env.GUMROAD_SELLER_ID || "yEC_7rEHqSKnDTE8FUoWmA==";
  if (seller_id && seller_id !== expectedSellerId) {
    console.log("⚠️ Invalid seller_id");
    return res.status(403).json({ error: "Invalid seller" });
  }

  if (!email) {
    return res.status(400).json({ error: "No email provided" });
  }

  // Handle subscription events
  if (refunded === "true" || subscription_cancelled_at || subscription_ended_at) {
    // Subscription cancelled or refunded
    removeSubscriber(email);
    console.log(`🚫 Subscription ended for: ${email}`);
  } else {
    // New purchase or active subscription
    addSubscriber(email);
    console.log(`🎉 New subscription: ${email}`);
  }

  res.status(200).json({ success: true });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", subscribers: loadSubscribers().length });
});

// Verify subscription (public API for MCP)
app.get("/verify/:email", (req, res) => {
  const email = req.params.email.toLowerCase().trim();
  const subscribers = loadSubscribers();
  const isSubscribed = subscribers.includes(email);

  res.json({
    email,
    subscribed: isSubscribed,
    status: isSubscribed ? "active" : "none"
  });
});

// List subscribers (protected - for admin use)
app.get("/subscribers", (req, res) => {
  const authKey = req.headers["x-admin-key"];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ emails: loadSubscribers() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
  console.log(`📁 Subscribers file: ${SUBSCRIBERS_FILE}`);
});
