import express from "express";
import * as fs from "fs";
import * as path from "path";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use /data directory for Railway persistent storage
const DATA_DIR = process.env.DATA_DIR || "./data";

// Product configuration
const PRODUCTS: Record<string, { id: string; name: string }> = {
  "store-screenshot-mcp": { id: "jgbll", name: "Store Screenshot MCP" },
  "cemyz": { id: "cemyz", name: "Store Automation MCP" },
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Get subscribers file path for a product
function getSubscribersFile(product: string): string {
  return path.join(DATA_DIR, `subscribers_${product}.json`);
}

// Load subscribers for a product
function loadSubscribers(product: string): string[] {
  try {
    const file = getSubscribersFile(product);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      return data.emails || [];
    }
  } catch (error) {
    console.error(`Error loading subscribers for ${product}:`, error);
  }
  return [];
}

// Save subscribers for a product
function saveSubscribers(product: string, emails: string[]): void {
  const file = getSubscribersFile(product);
  fs.writeFileSync(file, JSON.stringify({
    product,
    emails,
    updatedAt: new Date().toISOString()
  }, null, 2));
}

// Add subscriber to a product
function addSubscriber(product: string, email: string): boolean {
  const subscribers = loadSubscribers(product);
  const normalizedEmail = email.toLowerCase().trim();

  if (!subscribers.includes(normalizedEmail)) {
    subscribers.push(normalizedEmail);
    saveSubscribers(product, subscribers);
    console.log(`✅ [${product}] Added subscriber: ${normalizedEmail}`);
    return true;
  }
  console.log(`ℹ️ [${product}] Already subscribed: ${normalizedEmail}`);
  return false;
}

// Remove subscriber from a product
function removeSubscriber(product: string, email: string): boolean {
  const subscribers = loadSubscribers(product);
  const normalizedEmail = email.toLowerCase().trim();
  const index = subscribers.indexOf(normalizedEmail);

  if (index > -1) {
    subscribers.splice(index, 1);
    saveSubscribers(product, subscribers);
    console.log(`❌ [${product}] Removed subscriber: ${normalizedEmail}`);
    return true;
  }
  return false;
}

// Gumroad Ping Webhook endpoint (handles all products)
app.post("/webhook/gumroad", (req, res) => {
  console.log("📨 Received Gumroad Ping:", JSON.stringify(req.body, null, 2));

  const {
    email,
    seller_id,
    product_id,
    product_permalink,
    refunded,
    subscription_cancelled_at,
    subscription_ended_at,
  } = req.body;

  // Verify seller_id (optional security check)
  const expectedSellerId = process.env.GUMROAD_SELLER_ID;
  if (expectedSellerId && seller_id && seller_id !== expectedSellerId) {
    console.log("⚠️ Invalid seller_id");
    return res.status(403).json({ error: "Invalid seller" });
  }

  if (!email) {
    return res.status(400).json({ error: "No email provided" });
  }

  // Determine product from permalink
  const product = product_permalink || "unknown";

  if (!PRODUCTS[product]) {
    console.log(`⚠️ Unknown product: ${product}`);
    // Still process it, just log warning
  }

  // Handle subscription events
  if (refunded === "true" || subscription_cancelled_at || subscription_ended_at) {
    removeSubscriber(product, email);
    console.log(`🚫 [${product}] Subscription ended for: ${email}`);
  } else {
    addSubscriber(product, email);
    console.log(`🎉 [${product}] New subscription: ${email}`);
  }

  res.status(200).json({ success: true, product });
});

// Health check
app.get("/health", (req, res) => {
  const stats: Record<string, number> = {};
  for (const product of Object.keys(PRODUCTS)) {
    stats[product] = loadSubscribers(product).length;
  }

  res.json({
    status: "ok",
    service: "unified-gumroad-webhook",
    products: PRODUCTS,
    subscribers: stats,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Unified Gumroad Webhook Server",
    products: Object.keys(PRODUCTS),
    endpoints: {
      health: "GET /health",
      verify: "GET /verify/:product/:email",
      webhook: "POST /webhook/gumroad"
    }
  });
});

// Verify subscription for a specific product
app.get("/verify/:product/:email", (req, res) => {
  const product = req.params.product;
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();
  const subscribers = loadSubscribers(product);
  const isSubscribed = subscribers.includes(email);

  console.log(`🔍 [${product}] Verify: ${email} -> ${isSubscribed ? "subscribed" : "not found"}`);

  res.json({
    product,
    email,
    subscribed: isSubscribed,
    status: isSubscribed ? "active" : "none"
  });
});

// Legacy verify endpoint (for backwards compatibility)
// Checks all products
app.get("/verify/:email", (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();

  // Check all products
  for (const product of Object.keys(PRODUCTS)) {
    const subscribers = loadSubscribers(product);
    if (subscribers.includes(email)) {
      console.log(`🔍 [legacy] Verify: ${email} -> subscribed (${product})`);
      return res.json({
        email,
        subscribed: true,
        status: "active",
        product
      });
    }
  }

  console.log(`🔍 [legacy] Verify: ${email} -> not found`);
  res.json({
    email,
    subscribed: false,
    status: "none"
  });
});

// List subscribers (protected - for admin use)
app.get("/subscribers", (req, res) => {
  const authKey = req.headers["x-admin-key"];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const all: Record<string, string[]> = {};
  for (const product of Object.keys(PRODUCTS)) {
    all[product] = loadSubscribers(product);
  }

  res.json({ subscribers: all });
});

// Manual add subscriber (protected - for admin use)
app.post("/subscribers/add", (req, res) => {
  const authKey = req.headers["x-admin-key"];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { email, product } = req.body;
  if (!email || !product) {
    return res.status(400).json({ error: "Email and product required" });
  }

  const added = addSubscriber(product, email);
  res.json({ success: true, added, product, email: email.toLowerCase().trim() });
});

// Manual remove subscriber (protected - for admin use)
app.post("/subscribers/remove", (req, res) => {
  const authKey = req.headers["x-admin-key"];
  if (authKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { email, product } = req.body;
  if (!email || !product) {
    return res.status(400).json({ error: "Email and product required" });
  }

  const removed = removeSubscriber(product, email);
  res.json({ success: true, removed, product, email: email.toLowerCase().trim() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Unified Webhook Server running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`📦 Products: ${Object.keys(PRODUCTS).join(", ")}`);
  for (const product of Object.keys(PRODUCTS)) {
    console.log(`  - ${product}: ${loadSubscribers(product).length} subscribers`);
  }
});
