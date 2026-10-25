// scraper/bulk_ingest.js
// High-performance batch ingester for all scraped category datasets into Supabase

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://fuzwizxysoqcpucpllku.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1endpenh5c29xY3B1Y3BsbGt1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjkxODAxMiwiZXhwIjoyMTA4NDk0MDEyfQ.MVQYjahpozaqKLuZECQFbwDDJqubyb-s9N46W9kSHzc";

const CSV_MAPPINGS = [
  // Keyboards
  { file: "Keyboard/outputs/Keyboard_startech.csv", vendor: "Star Tech", category: "Keyboard" },
  { file: "Keyboard/outputs/Keyboard-techland.csv", vendor: "Tech Land", category: "Keyboard" },
  { file: "Keyboard/outputs/Keyboard_ryans.csv", vendor: "Ryans", category: "Keyboard" },
  
  // Monitors
  { file: "Monitor/outputs/Startech_Monitor.csv", vendor: "Star Tech", category: "Monitor" },
  { file: "Monitor/outputs/Techland_Monitor.csv", vendor: "Tech Land", category: "Monitor" },
  { file: "Monitor/outputs/Ryans_Monitor.csv", vendor: "Ryans", category: "Monitor" },

  // SSDs
  { file: "SSD/outputs/Startech_SSD.csv", vendor: "Star Tech", category: "SSD" },
  { file: "SSD/outputs/SSD-techland.csv", vendor: "Tech Land", category: "SSD" },
  { file: "SSD/outputs/Ryans_SSD.csv", vendor: "Ryans", category: "SSD" },
  { file: "SSD/outputs/PC_house_BD-SSD.csv", vendor: "PC House BD", category: "SSD" },
  { file: "SSD/outputs/Computer_village-SSD.csv", vendor: "Computer Village", category: "SSD" },
  { file: "SSD/outputs/UCC_SSD.csv", vendor: "UCC", category: "SSD" },
  { file: "SSD/outputs/Potakait-SSD.csv", vendor: "Potaka IT", category: "SSD" },

  // Laptops
  { file: "Laptop/outputs/Laptop_startech.csv", vendor: "Star Tech", category: "Laptop" },
  { file: "Laptop/outputs/Laptop-techland.csv", vendor: "Tech Land", category: "Laptop" },
  { file: "Laptop/outputs/Ryans_Laptop.csv", vendor: "Ryans", category: "Laptop" },

  // Mice
  { file: "Mouse/outputs/startech_mouse.csv", vendor: "Star Tech", category: "Mouse" },
  { file: "Mouse/outputs/Techland-mouse.csv", vendor: "Tech Land", category: "Mouse" },

  // Processors
  { file: "Processor/outputs/BDstall-processor.csv", vendor: "BDstall", category: "Processor" }
];

function cleanPrice(priceStr) {
  if (!priceStr) return 0;
  const digits = String(priceStr).replace(/[^0-9.]/g, "");
  return parseFloat(digits) || 0;
}

function parseCSVLine(line) {
  // Support both pipe '|' and standard CSV
  let parts = [];
  if (line.includes("|")) {
    parts = line.split("|").map(p => p.trim());
  } else {
    // Basic comma splitter
    parts = line.split(",").map(p => p.trim().replace(/^"|"$/g, ""));
  }
  return parts;
}

async function sendBatch(batch) {
  if (batch.length === 0) return { processed: 0, price_updates: 0 };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_scraped_batch`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items: batch })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase push failed: ${res.status} - ${txt}`);
  }

  return await res.json();
}

async function main() {
  console.log("==========================================================");
  console.log("  TECHPULSE BD — OPTIMAL BULK HARDWARE INGESTION ENGINE   ");
  console.log("==========================================================");

  const baseDir = path.join(__dirname, "Scraper_Projects");
  let grandTotal = 0;
  let skippedTotal = 0;

  for (const m of CSV_MAPPINGS) {
    const fullPath = path.join(baseDir, m.file);
    if (!fs.existsSync(fullPath)) {
      console.log(`[SKIP] Missing file: ${m.file}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) continue;

    console.log(`\n📂 Processing [${m.category}] from [${m.vendor}] (${lines.length - 1} records in ${m.file})...`);

    const items = [];
    const seenUrls = new Set();

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i]);
      if (parts.length < 4) continue;

      const title = parts[0];
      const link = parts[1];
      const image = parts[2] || "";
      const price = cleanPrice(parts[3]);
      const status = parts[4] || "In Stock";

      // Validation
      if (!title || title.length < 3) continue;
      if (!link || (!link.startsWith("http://") && !link.startsWith("https://"))) continue;
      if (price < 100 || price > 2500000) continue;
      if (seenUrls.has(link)) continue;
      seenUrls.add(link);

      items.push({
        vendor_name: m.vendor,
        title: title.slice(0, 250),
        product_url: link,
        image_url: image.startsWith("http") ? image : "",
        price: price,
        stock_status: status.slice(0, 50),
        category: m.category
      });
    }

    // Ingest in chunks of 50
    const CHUNK_SIZE = 50;
    let categoryProcessed = 0;

    for (let idx = 0; idx < items.length; idx += CHUNK_SIZE) {
      const chunk = items.slice(idx, idx + CHUNK_SIZE);
      try {
        const result = await sendBatch(chunk);
        categoryProcessed += (result.processed || chunk.length);
        process.stdout.write(`  ✔ Synced batch: ${categoryProcessed}/${items.length} items...\r`);
      } catch (err) {
        console.error(`\n  ⚠️ Batch error: ${err.message}`);
      }
    }

    console.log(`\n  ✔ Finished [${m.category}] - ${m.vendor}: ${categoryProcessed} items ingested.`);
    grandTotal += categoryProcessed;
  }

  console.log("\n==========================================================");
  console.log(`  🎉 INGESTION COMPLETE: ${grandTotal} TOTAL PRODUCTS LIVE! `);
  console.log("==========================================================");
}

main().catch(console.error);
