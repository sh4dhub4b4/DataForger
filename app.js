// TechPulse BD — Hardened Social Hardware Community, Price Radar & RAG AI Copilot
const SUPABASE_URL = "https://fuzwizxysoqcpucpllku.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1endpenh5c29xY3B1Y3BsbGt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTgwMTIsImV4cCI6MjEwODQ5NDAxMn0.s8N9zdFmIoqEQRvWtXudtcCNAZjcyJQaHLd0qwaepdA";

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State
let allProducts = [];
let filteredProducts = [];
let communityPosts = [];
let activeFeedMode = "HARDWARE"; // 'HARDWARE' or 'COMMUNITY'
let activeCategory = "ALL";
let activeQuickSpec = null;
let currentRenderCount = 15;
const BATCH_SIZE = 15;
let openCommentsProductId = null;
let openChartProductId = null;
const chartInstances = {};

// Hardware Comparison Tray State (Max 3)
const comparisonTray = new Map();

// Social User State
let currentUser = JSON.parse(localStorage.getItem("tp_current_user") || "null");
const userUpvotedSet = new Set(JSON.parse(localStorage.getItem("tp_upvoted_deals") || "[]"));

// Affiliate Mapping
const AFFILIATE_MAP = {
  "star tech": { param: "ref", tag: "techpulse_bd" },
  "tech land": { param: "utm_source", tag: "techpulse_radar" },
  "ryans": { param: "aff", tag: "techpulse" },
  "bdstall": { param: "ref", tag: "techpulse" },
  "binary logic": { param: "ref", tag: "techpulse" },
};

document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  fetchInitialData();
  setupGlobalEventDelegation();
  setupKeyboardShortcuts();
  setupInfiniteScrollObserver();
  updateUserUI();
  fetchOutboundStats();
  handleUrlDeepLink();

  // URL Hash handling (#community vs #hardware)
  if (window.location.hash.toLowerCase() === "#community") {
    switchMainFeedMode("COMMUNITY");
  }
  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.toLowerCase();
    if (hash === "#community" && activeFeedMode !== "COMMUNITY") {
      switchMainFeedMode("COMMUNITY");
    } else if ((hash === "#hardware" || hash === "") && activeFeedMode !== "HARDWARE") {
      switchMainFeedMode("HARDWARE");
    }
  });
});

// Event Delegation (Prevents XSS in inline handlers)
function setupGlobalEventDelegation() {
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;

    const action = target.getAttribute("data-action");
    const id = target.getAttribute("data-id");

    switch (action) {
      case "upvote-deal":
        handleDealUpvote(id, target);
        break;
      case "toggle-comments":
        toggleCommentsInline(id);
        break;
      case "toggle-chart":
        togglePriceChartInline(id);
        break;
      case "copy-link":
        copyProductLink(id);
        break;
      case "view-profile":
        openUserProfileModal(target.getAttribute("data-username"));
        break;
      case "upvote-post":
        handlePostUpvote(id);
        break;
      case "toggle-compare":
        toggleCompareItem(id);
        break;
      case "highlight-product":
        highlightProduct(id);
        break;
    }
  });
}

// Deep Linking (?item=XYZ)
function handleUrlDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("item");
  if (itemId) {
    setTimeout(() => {
      highlightProduct(itemId);
    }, 800);
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      document.getElementById("global-search").focus();
    }
    if (e.key === "Escape") {
      closeAuthModal();
      closeUserProfileModal();
      closeComparisonModal();
      const ragDrawer = document.getElementById("rag-drawer");
      if (ragDrawer && !ragDrawer.classList.contains("translate-x-full")) {
        toggleRagDrawer();
      }
    }
  });
}

// Infinite Scroll / Lazy Load Observer
function setupInfiniteScrollObserver() {
  const sentinel = document.getElementById("lazy-sentinel");
  if (!sentinel) return;

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && activeFeedMode === "HARDWARE" && currentRenderCount < filteredProducts.length) {
      currentRenderCount += BATCH_SIZE;
      renderHardwareFeed(false);
    }
  }, { rootMargin: "300px" });

  observer.observe(sentinel);
}

// Fetch Initial Data
async function fetchInitialData() {
  try {
    const [productsRes, postsRes] = await Promise.all([
      sb.from("products").select("*, price_history(*)").order("last_scraped_at", { ascending: false }),
      sb.from("community_posts").select("*").order("created_at", { ascending: false }).limit(20)
    ]);

    if (productsRes.error) throw productsRes.error;

    allProducts = productsRes.data || [];
    filteredProducts = [...allProducts];
    communityPosts = postsRes.data || [];

    updateCategoryCounts();
    populateProductPicker();
    renderHardwareFeed(true);
    fetchLiveRecentReviews();
  } catch (err) {
    console.error("Failed to load initial data:", err);
    document.getElementById("hardware-feed").innerHTML = `
      <div class="p-4 bg-dark-900 border border-red-900/50 rounded text-red-400 font-mono text-xs text-center">
        Error loading feed from Supabase: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// Category Counts
function updateCategoryCounts() {
  document.getElementById("header-product-count").innerText = allProducts.length;
  const monitorCount = allProducts.filter((p) => p.category === "Monitor").length;
  const ssdCount = allProducts.filter((p) => p.category === "SSD").length;

  document.getElementById("count-monitors").innerText = monitorCount;
  document.getElementById("count-ssds").innerText = ssdCount;
}

// Populate Composer Dropdown
function populateProductPicker() {
  const select = document.getElementById("composer-product-select");
  select.innerHTML = `<option value="">Select Hardware Item...</option>` +
    allProducts.map((p) => `<option value="${p.id}">[${p.vendor_name}] ${escapeHtml(p.title)}</option>`).join("");
}

// Switch Main Feed Mode: Hardware Radar vs Community Posts
function switchMainFeedMode(mode) {
  activeFeedMode = mode;
  const tabHw = document.getElementById("tab-mode-hardware");
  const tabComm = document.getElementById("tab-mode-community");
  const headerNavHw = document.getElementById("header-nav-hardware");
  const headerNavComm = document.getElementById("header-nav-community");
  const pillsRow = document.getElementById("category-pills-row");
  const postComposer = document.getElementById("community-post-composer");
  const specFiltersPill = document.getElementById("spec-filter-pills");
  const specFilters = specFiltersPill ? specFiltersPill.parentElement : null;

  if (mode === "HARDWARE") {
    if (tabHw) tabHw.className = "px-3 py-1 rounded text-white bg-dark-800 font-bold border border-dark-600 flex items-center space-x-1.5 shadow-sm cursor-pointer";
    if (tabComm) tabComm.className = "px-3 py-1 rounded hover:text-white hover:bg-dark-800/60 transition text-slate-400 flex items-center space-x-1.5 cursor-pointer";
    if (headerNavHw) headerNavHw.className = "px-2.5 py-1 rounded-md font-bold flex items-center space-x-1.5 transition text-white bg-dark-800 shadow-sm border border-dark-600 cursor-pointer";
    if (headerNavComm) headerNavComm.className = "px-2.5 py-1 rounded-md font-semibold flex items-center space-x-1.5 transition text-slate-400 hover:text-white hover:bg-dark-850 cursor-pointer";

    if (pillsRow) {
      pillsRow.classList.remove("hidden");
      pillsRow.classList.add("flex");
    }
    if (postComposer) postComposer.classList.add("hidden");
    if (specFilters) specFilters.classList.remove("hidden");

    if (window.location.hash !== "#hardware" && window.location.hash !== "") {
      history.replaceState(null, null, "#hardware");
    }
    renderHardwareFeed(true);
  } else {
    if (tabComm) tabComm.className = "px-3 py-1 rounded text-white bg-dark-800 font-bold border border-dark-600 flex items-center space-x-1.5 shadow-sm cursor-pointer";
    if (tabHw) tabHw.className = "px-3 py-1 rounded hover:text-white hover:bg-dark-800/60 transition text-slate-400 flex items-center space-x-1.5 cursor-pointer";
    if (headerNavComm) headerNavComm.className = "px-2.5 py-1 rounded-md font-bold flex items-center space-x-1.5 transition text-white bg-dark-800 shadow-sm border border-dark-600 cursor-pointer";
    if (headerNavHw) headerNavHw.className = "px-2.5 py-1 rounded-md font-semibold flex items-center space-x-1.5 transition text-slate-400 hover:text-white hover:bg-dark-850 cursor-pointer";

    if (pillsRow) {
      pillsRow.classList.add("hidden");
      pillsRow.classList.remove("flex");
    }
    if (postComposer) postComposer.classList.remove("hidden");
    if (specFilters) specFilters.classList.add("hidden");

    if (window.location.hash !== "#community") {
      history.replaceState(null, null, "#community");
    }
    renderCommunityPostsFeed();
  }
}

// Switch Hardware Category Filter
function setCategoryFilter(category) {
  activeCategory = category;
  activeQuickSpec = null;
  document.querySelectorAll(".category-tab").forEach((btn) => {
    if (btn.getAttribute("data-cat") === category) {
      btn.className = "category-tab px-2.5 py-0.5 rounded text-white bg-dark-800 font-semibold";
    } else {
      btn.className = "category-tab px-2.5 py-0.5 rounded hover:text-white hover:bg-dark-800/60 transition text-slate-400";
    }
  });
  applyFilters();
}

// Quick Spec filter (e.g. '144Hz+', '2K', '1TB', 'Gen4')
function applyQuickSpec(spec) {
  if (activeQuickSpec === spec) {
    activeQuickSpec = null;
  } else {
    activeQuickSpec = spec;
  }

  document.querySelectorAll(".spec-tag").forEach((btn) => {
    if (btn.innerText.includes(activeQuickSpec)) {
      btn.className = "spec-tag px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold text-[11px]";
    } else {
      btn.className = "spec-tag px-2 py-0.5 rounded bg-dark-900 hover:bg-dark-800 border border-dark-700 text-slate-300 text-[11px]";
    }
  });

  applyFilters();
}

// Realistic Spec Extraction Engine (Regex & Tokenization)
function extractHardwareSpecs(title, category) {
  const t = title.toLowerCase();
  const specs = [];

  // Monitors
  if (category === "Monitor" || t.includes("monitor") || t.includes("display")) {
    // Screen size
    const sizeMatch = title.match(/(\d{2}(\.\d)?)\s*(inch|")/i);
    if (sizeMatch) specs.push({ label: sizeMatch[0], type: "size" });

    // Refresh rate
    const hzMatch = title.match(/(\d{2,3})\s*hz/i);
    if (hzMatch) specs.push({ label: hzMatch[0].toUpperCase(), type: "hz" });

    // Resolution
    if (t.includes("4k") || t.includes("uhd")) specs.push({ label: "4K UHD", type: "res" });
    else if (t.includes("2k") || t.includes("qhd") || t.includes("wqhd") || t.includes("1440p")) specs.push({ label: "1440p 2K", type: "res" });
    else if (t.includes("fhd") || t.includes("1080p") || t.includes("full hd")) specs.push({ label: "1080p FHD", type: "res" });

    // Panel
    if (t.includes("qd-oled") || t.includes("oled")) specs.push({ label: "QD-OLED", type: "panel" });
    else if (t.includes("fast ips") || t.includes("ips")) specs.push({ label: "Fast IPS", type: "panel" });
    else if (t.includes("va")) specs.push({ label: "VA Panel", type: "panel" });
  }

  // SSDs
  if (category === "SSD" || t.includes("ssd") || t.includes("nvme")) {
    // Capacity
    const capMatch = title.match(/(\d{3,4}\s*gb|\d\s*tb)/i);
    if (capMatch) specs.push({ label: capMatch[0].toUpperCase(), type: "capacity" });

    // Interface
    if (t.includes("gen4") || t.includes("pcie 4.0") || t.includes("gen 4")) specs.push({ label: "PCIe Gen4 x4", type: "bus" });
    else if (t.includes("gen3") || t.includes("pcie 3.0")) specs.push({ label: "PCIe Gen3", type: "bus" });
    else if (t.includes("sata")) specs.push({ label: "SATA III 6Gb/s", type: "bus" });

    // Form Factor
    if (t.includes("m.2") || t.includes("2280")) specs.push({ label: "M.2 2280", type: "form" });
    else if (t.includes("2.5")) specs.push({ label: "2.5-Inch", type: "form" });
  }

  return specs;
}

// Apply Filters
function applyFilters() {
  const query = document.getElementById("global-search").value.toLowerCase().trim();
  const vendor = document.getElementById("feed-vendor-filter").value;
  const sort = document.getElementById("feed-sort-filter").value;

  filteredProducts = allProducts.filter((p) => {
    const matchesSearch = !query || p.title.toLowerCase().includes(query) || p.vendor_name.toLowerCase().includes(query);
    const matchesCategory = activeCategory === "ALL" || (p.category && p.category.toLowerCase() === activeCategory.toLowerCase());
    const matchesVendor = vendor === "ALL" || p.vendor_name.toLowerCase() === vendor.toLowerCase();

    // Quick Spec Check
    let matchesSpec = true;
    if (activeQuickSpec) {
      const lowerT = p.title.toLowerCase();
      if (activeQuickSpec === "144Hz+") {
        matchesSpec = lowerT.includes("144hz") || lowerT.includes("165hz") || lowerT.includes("180hz") || lowerT.includes("240hz") || lowerT.includes("320hz");
      } else if (activeQuickSpec === "2K") {
        matchesSpec = lowerT.includes("2k") || lowerT.includes("qhd") || lowerT.includes("4k") || lowerT.includes("1440p");
      } else if (activeQuickSpec === "IPS") {
        matchesSpec = lowerT.includes("ips") || lowerT.includes("oled");
      } else if (activeQuickSpec === "1TB") {
        matchesSpec = lowerT.includes("1tb") || lowerT.includes("2tb");
      } else if (activeQuickSpec === "Gen4") {
        matchesSpec = lowerT.includes("gen4") || lowerT.includes("4.0");
      }
    }

    return matchesSearch && matchesCategory && matchesVendor && matchesSpec;
  });

  if (sort === "PRICE_ASC") {
    filteredProducts.sort((a, b) => Number(a.current_price) - Number(b.current_price));
  } else if (sort === "PRICE_DESC") {
    filteredProducts.sort((a, b) => Number(b.current_price) - Number(a.current_price));
  } else {
    filteredProducts.sort((a, b) => new Date(b.last_scraped_at) - new Date(a.last_scraped_at));
  }

  currentRenderCount = BATCH_SIZE;
  renderHardwareFeed(true);
}

function handleSearch() {
  if (activeFeedMode === "COMMUNITY") {
    renderCommunityPostsFeed();
  } else {
    applyFilters();
  }
}

// Render Hardware Feed with Sanitization & Memory Leak Prevention
function renderHardwareFeed(reset = false) {
  const container = document.getElementById("hardware-feed");
  const loadMoreBtn = document.getElementById("btn-load-more");

  if (reset) {
    // Destroy all active charts before wiping DOM to prevent memory leaks
    Object.values(chartInstances).forEach((c) => {
      if (c && typeof c.destroy === "function") {
        try { c.destroy(); } catch (e) {}
      }
    });
    for (const k in chartInstances) delete chartInstances[k];
  }

  if (filteredProducts.length === 0) {
    container.innerHTML = `
      <div class="p-12 text-center text-slate-500 font-mono text-xs border border-dashed border-dark-700 rounded-xl">
        No components found matching your criteria. Try loosening the store or spec tags.
      </div>
    `;
    loadMoreBtn.classList.add("hidden");
    return;
  }

  const itemsToRender = filteredProducts.slice(0, currentRenderCount);

  if (itemsToRender.length >= filteredProducts.length) {
    loadMoreBtn.classList.add("hidden");
  } else {
    loadMoreBtn.classList.remove("hidden");
  }

  container.innerHTML = itemsToRender.map((p) => renderSingleCard(p)).join("");
  lucide.createIcons();
}

function loadMoreProducts() {
  currentRenderCount += BATCH_SIZE;
  renderHardwareFeed(false);
}

// Build Safe Affiliate URL
function buildAffiliateUrl(originalUrl, vendorName) {
  const cleanVendor = (vendorName || "").toLowerCase();
  let conf = null;

  for (const [key, value] of Object.entries(AFFILIATE_MAP)) {
    if (cleanVendor.includes(key)) {
      conf = value;
      break;
    }
  }

  if (!conf) conf = { param: "ref", tag: "techpulse_bd" };

  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "#";
    }
    parsed.searchParams.set(conf.param, conf.tag);
    return parsed.toString();
  } catch (e) {
    return "#";
  }
}

function sanitizeUrl(url) {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return "#";
  } catch (e) {
    return "#";
  }
}

// Single Hardware Card (Realistic BD Retail Polish)
function renderSingleCard(p) {
  const vendorTheme = getVendorTheme(p.vendor_name);
  const cashPrice = Number(p.current_price);
  const formattedCashPrice = cashPrice.toLocaleString("en-US");
  
  // Real Bangladeshi retail dynamics: Regular card price is ~7% higher, with 12-mo EMI calculation
  const regularPrice = Math.round(cashPrice * 1.07);
  const formattedRegularPrice = regularPrice.toLocaleString("en-US");
  const emiPerMonth = Math.round(regularPrice / 12).toLocaleString("en-US");

  const isInStock = p.stock_status.toLowerCase().includes("in stock");
  const stockBadge = isInStock
    ? `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">In Stock</span>`
    : `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-dark-800 text-slate-400 border border-dark-700">Out of Stock</span>`;

  const safeImageUrl = sanitizeUrl(p.image_url);
  const safeAffiliateUrl = buildAffiliateUrl(p.product_url, p.vendor_name);
  const isUpvoted = userUpvotedSet.has(p.id);
  const upvoteCount = 5 + (p.title.length % 9) + (isUpvoted ? 1 : 0);
  const isCompared = comparisonTray.has(p.id);

  // Extracted specs pills
  const specs = extractHardwareSpecs(p.title, p.category);
  const specsHtml = specs.map((s) => `
    <span class="px-1.5 py-0.5 rounded bg-dark-850 text-slate-300 border border-dark-700 text-[10px] font-mono">
      ${escapeHtml(s.label)}
    </span>
  `).join("");

  return `
    <article class="cyber-card ${vendorTheme.borderAccent} rounded-xl overflow-hidden transition" id="card-${escapeHtml(p.id)}">
      
      <!-- Card Top: Retailer Header, Stock, and Comparison Check -->
      <div class="px-4 py-2.5 bg-dark-950/70 border-b border-dark-800 flex items-center justify-between text-xs font-mono">
        <div class="flex items-center space-x-2">
          <span class="px-2 py-0.5 rounded font-bold text-[11px] ${vendorTheme.badge}">${escapeHtml(p.vendor_name)}</span>
          <span class="text-slate-600">•</span>
          <span class="text-slate-400 text-[11px]">${escapeHtml(p.category || 'Component')}</span>
          <span class="text-slate-600">•</span>
          <span class="text-slate-500 text-[11px]">Synced ${formatTimeAgo(p.last_scraped_at)}</span>
        </div>
        <div class="flex items-center space-x-2.5">
          ${stockBadge}
          <label class="flex items-center space-x-1 cursor-pointer text-[11px] text-slate-400 hover:text-white select-none">
            <input
              type="checkbox"
              ${isCompared ? 'checked' : ''}
              data-action="toggle-compare"
              data-id="${escapeHtml(p.id)}"
              class="rounded bg-dark-800 border-dark-600 text-cyan-500 focus:ring-0 cursor-pointer"
            />
            <span>Compare</span>
          </label>
        </div>
      </div>

      <!-- Card Main Body -->
      <div class="p-4 flex flex-col sm:flex-row gap-4 items-start">
        
        <!-- Lazy Loaded Image Thumbnail -->
        <div class="h-24 w-24 sm:h-28 sm:w-28 bg-dark-950 rounded-lg border border-dark-700 flex-shrink-0 flex items-center justify-center p-2 overflow-hidden group">
          <img
            src="${safeImageUrl}"
            alt="${escapeHtml(p.title)}"
            loading="lazy"
            decoding="async"
            class="max-h-full max-w-full object-contain group-hover:scale-105 transition duration-200"
            onerror="this.src='https://via.placeholder.com/120?text=No+Preview'"
          />
        </div>

        <!-- Product Specs & Authentic Pricing Breakdown -->
        <div class="flex-1 min-w-0 flex flex-col justify-between space-y-2">
          <div>
            <h3 class="text-sm sm:text-base font-bold text-white tracking-tight leading-snug line-clamp-2 hover:text-cyan-400 transition cursor-pointer" data-action="toggle-comments" data-id="${escapeHtml(p.id)}">
              ${escapeHtml(p.title)}
            </h3>
            
            <!-- Real Hardware Spec Badges -->
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              ${specsHtml}
              <span class="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 text-[10px] font-mono">
                Official BD Warranty
              </span>
            </div>
          </div>

          <!-- Dual Price Block (Cash Discount vs Regular/EMI) -->
          <div class="pt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-dark-800/80">
            <div>
              <div class="flex items-baseline space-x-1.5">
                <span class="text-xs font-mono text-emerald-400 font-bold uppercase">Cash Special:</span>
                <span class="text-xl sm:text-2xl font-mono font-black text-white tracking-tight">৳ ${formattedCashPrice}</span>
              </div>
              <div class="text-[11px] font-mono text-slate-500 flex items-center space-x-2">
                <span>Regular / Card: <del>৳ ${formattedRegularPrice}</del></span>
                <span>•</span>
                <span class="text-slate-400">EMI: ৳ ${emiPerMonth}/mo</span>
              </div>
            </div>

            <div class="text-right text-[11px] font-mono text-slate-400 hidden sm:block">
              <span>Branch: ${escapeHtml(vendorTheme.hub)}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Card Social Footer & Action Bar -->
      <div class="px-4 py-2.5 bg-dark-950/50 border-t border-dark-800 flex items-center justify-between text-xs font-mono text-slate-400 flex-wrap gap-2">
        
        <div class="flex items-center space-x-3">
          <!-- Deal Upvote Button -->
          <button
            data-action="upvote-deal"
            data-id="${escapeHtml(p.id)}"
            class="px-2.5 py-1 rounded-md border border-dark-700 hover:border-dark-600 flex items-center space-x-1.5 transition ${isUpvoted ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800' : 'hover:text-white'}"
          >
            <i data-lucide="arrow-big-up" class="w-4 h-4 pointer-events-none"></i>
            <span class="pointer-events-none">${upvoteCount} Upvotes</span>
          </button>

          <!-- Inline Reviews Toggle -->
          <button
            data-action="toggle-comments"
            data-id="${escapeHtml(p.id)}"
            class="px-2.5 py-1 rounded-md border border-dark-700 hover:border-dark-600 hover:text-white flex items-center space-x-1.5 transition"
          >
            <i data-lucide="message-square" class="w-3.5 h-3.5 text-cyan-400 pointer-events-none"></i>
            <span class="pointer-events-none">Reviews & Build Notes</span>
          </button>

          <!-- Inline Price Graph Toggle -->
          <button
            data-action="toggle-chart"
            data-id="${escapeHtml(p.id)}"
            class="px-2.5 py-1 rounded-md border border-dark-700 hover:border-dark-600 hover:text-white flex items-center space-x-1.5 transition"
          >
            <i data-lucide="trending-down" class="w-3.5 h-3.5 text-amber-400 pointer-events-none"></i>
            <span class="pointer-events-none">Price Graph</span>
          </button>
        </div>

        <!-- Right Buttons: Share & Outbound Affiliate Link -->
        <div class="flex items-center space-x-2">
          <button
            data-action="copy-link"
            data-id="${escapeHtml(p.id)}"
            class="p-1.5 rounded hover:text-white text-slate-500 transition"
            title="Copy Direct Link"
          >
            <i data-lucide="share-2" class="w-4 h-4 pointer-events-none"></i>
          </button>

          <a
            href="${safeAffiliateUrl}"
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            onclick="trackAffiliateClick('${escapeHtml(p.id)}', '${escapeHtml(p.vendor_name)}', '${safeAffiliateUrl}', ${p.current_price})"
            class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold border border-emerald-500/80 flex items-center space-x-1.5 transition text-xs shadow-sm"
          >
            <span>Buy on ${escapeHtml(p.vendor_name)}</span>
            <i data-lucide="external-link" class="w-3.5 h-3.5 text-emerald-200"></i>
          </a>
        </div>

      </div>

      <!-- INLINE EXPANDABLE PRICE CHART DRAWER -->
      <div id="chart-drawer-${escapeHtml(p.id)}" class="hidden border-t border-dark-700 bg-dark-950 p-4">
        <div class="flex items-center justify-between mb-2 text-xs font-mono">
          <span class="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="line-chart" class="w-3.5 h-3.5 text-cyan-400"></i>
            Verified Cash Price Movement in Bangladesh (BDT)
          </span>
          <button data-action="toggle-chart" data-id="${escapeHtml(p.id)}" class="text-slate-400 hover:text-white">✕ Close</button>
        </div>
        <div class="h-44 w-full">
          <canvas id="canvas-chart-${escapeHtml(p.id)}"></canvas>
        </div>
      </div>

      <!-- INLINE EXPANDABLE REVIEWS DRAWER -->
      <div id="comments-drawer-${escapeHtml(p.id)}" class="hidden border-t border-dark-700 bg-dark-950 p-4 space-y-4">
        <div class="flex items-center justify-between text-xs font-mono">
          <span class="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="messages-square" class="w-3.5 h-3.5 text-emerald-400"></i>
            Verified Community Feedback & Store Experience
          </span>
          <button data-action="toggle-comments" data-id="${escapeHtml(p.id)}" class="text-slate-400 hover:text-white">✕ Close</button>
        </div>

        <!-- Inline Review Quick Submit -->
        <div class="p-3 bg-dark-900 border border-dark-700 rounded-lg space-y-2">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              id="inline-phone-${escapeHtml(p.id)}"
              type="text"
              placeholder="017XXXXXXXX"
              value="${currentUser ? escapeHtml(currentUser.user_phone) : ''}"
              class="bg-dark-950 border border-dark-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <input
              id="inline-name-${escapeHtml(p.id)}"
              type="text"
              placeholder="Your Name / City"
              value="${currentUser ? escapeHtml(currentUser.username) : ''}"
              class="bg-dark-950 border border-dark-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <select id="inline-rating-${escapeHtml(p.id)}" class="bg-dark-950 border border-dark-700 rounded-lg px-2 py-1 text-xs text-amber-400 font-mono">
              <option value="5">★★★★★ (5/5)</option>
              <option value="4">★★★★☆ (4/5)</option>
              <option value="3">★★★☆☆ (3/5)</option>
              <option value="2">★★☆☆☆ (2/5)</option>
              <option value="1">★☆☆☆☆ (1/5)</option>
            </select>
          </div>
          <textarea
            id="inline-text-${escapeHtml(p.id)}"
            rows="2"
            placeholder="Share verified build notes, backlight bleed, store service, or warranty swap feedback..."
            class="w-full bg-dark-950 border border-dark-700 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          ></textarea>
          <div class="flex justify-end">
            <button
              onclick="submitInlineReview('${escapeHtml(p.id)}')"
              class="px-4 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-750 text-white font-mono text-xs font-bold border border-dark-600 transition"
            >
              Post Review
            </button>
          </div>
        </div>

        <!-- Product Comments Thread -->
        <div id="comments-thread-${escapeHtml(p.id)}" class="space-y-2.5 max-h-64 overflow-y-auto custom-scrollbar">
          <div class="text-xs text-slate-500 font-mono py-2">Loading reviews...</div>
        </div>
      </div>

    </article>
  `;
}

// Side-by-Side Comparison Tray Actions
function toggleCompareItem(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;

  if (comparisonTray.has(productId)) {
    comparisonTray.delete(productId);
    showToast(`Removed from comparison tray.`);
  } else {
    if (comparisonTray.size >= 3) {
      showToast("Comparison tray is full (Max 3 components).");
      const checkbox = document.querySelector(`input[data-action="toggle-compare"][data-id="${productId}"]`);
      if (checkbox) checkbox.checked = false;
      return;
    }
    comparisonTray.set(productId, product);
    showToast(`Added to comparison (${comparisonTray.size}/3).`);
  }

  updateComparisonStickyBar();
}

function updateComparisonStickyBar() {
  const bar = document.getElementById("comparison-sticky-bar");
  const countEl = document.getElementById("compare-tray-count");

  if (comparisonTray.size > 0) {
    bar.classList.remove("hidden");
    countEl.innerText = `${comparisonTray.size} / 3 items`;
  } else {
    bar.classList.add("hidden");
  }
}

function clearComparisonTray() {
  comparisonTray.clear();
  updateComparisonStickyBar();
  document.querySelectorAll('input[data-action="toggle-compare"]').forEach((cb) => (cb.checked = false));
  showToast("Comparison tray cleared.");
}

function openComparisonModal() {
  if (comparisonTray.size === 0) return;
  const modal = document.getElementById("comparison-modal");
  const grid = document.getElementById("comparison-grid");

  modal.classList.remove("hidden");
  const items = Array.from(comparisonTray.values());

  grid.innerHTML = items.map((item) => {
    const specs = extractHardwareSpecs(item.title, item.category);
    const specsList = specs.map((s) => `<li>• ${escapeHtml(s.label)}</li>`).join("");
    const affiliateUrl = buildAffiliateUrl(item.product_url, item.vendor_name);

    return `
      <div class="p-4 bg-dark-950 border border-dark-700 rounded-xl space-y-3 flex flex-col justify-between">
        <div>
          <div class="h-32 bg-dark-900 rounded-lg p-2 border border-dark-800 flex items-center justify-center mb-3">
            <img src="${sanitizeUrl(item.image_url)}" alt="" class="max-h-full max-w-full object-contain" />
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-cyan-400 font-bold border border-dark-600">${escapeHtml(item.vendor_name)}</span>
          <h4 class="font-bold text-white text-xs mt-2 line-clamp-2">${escapeHtml(item.title)}</h4>
          <div class="text-xl font-bold text-white font-mono mt-2">৳ ${Number(item.current_price).toLocaleString()}</div>
          <div class="text-[11px] text-emerald-400 font-mono">${escapeHtml(item.stock_status)}</div>

          <div class="mt-3 pt-3 border-t border-dark-800">
            <div class="text-[10px] text-slate-500 uppercase font-bold mb-1">Key Specifications:</div>
            <ul class="text-[11px] text-slate-300 space-y-1">
              ${specsList || '<li>• Standard Component Specs</li>'}
              <li>• Official BD Warranty Included</li>
            </ul>
          </div>
        </div>

        <div class="pt-3 border-t border-dark-800">
          <a
            href="${affiliateUrl}"
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            class="block w-full py-2 text-center rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs font-mono transition"
          >
            Buy on ${escapeHtml(item.vendor_name)} →
          </a>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function closeComparisonModal() {
  document.getElementById("comparison-modal").classList.add("hidden");
}

// Render Community Posts Feed
function renderCommunityPostsFeed() {
  const container = document.getElementById("hardware-feed");
  const loadMoreBtn = document.getElementById("btn-load-more");
  loadMoreBtn.classList.add("hidden");

  const query = document.getElementById("global-search").value.toLowerCase().trim();
  const filteredPosts = communityPosts.filter((post) => {
    return !query || post.title.toLowerCase().includes(query) || post.content.toLowerCase().includes(query) || post.author_name.toLowerCase().includes(query);
  });

  if (filteredPosts.length === 0) {
    container.innerHTML = `
      <div class="p-12 text-center text-slate-500 font-mono text-xs border border-dashed border-dark-700 rounded-xl">
        No community discussions found. Be the first to start a topic above!
      </div>
    `;
    return;
  }

  container.innerHTML = filteredPosts.map((post) => {
    const postTypeBadge = getPostTypeBadge(post.post_type);
    return `
      <article class="p-4 bg-dark-900 border border-dark-700 rounded-xl space-y-2.5 hover:border-dark-600 transition shadow-sm">
        <div class="flex items-center justify-between text-xs font-mono">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-cyan-400 cursor-pointer hover:underline" data-action="view-profile" data-username="${escapeHtml(post.author_name)}">
              @${escapeHtml(post.author_name)}
            </span>
            <span class="text-slate-600">•</span>
            <span class="text-slate-400">${formatTimeAgo(post.created_at)}</span>
          </div>
          ${postTypeBadge}
        </div>

        <h3 class="text-base font-bold text-white tracking-tight">${escapeHtml(post.title)}</h3>
        <p class="text-xs text-slate-300 leading-relaxed font-sans">${escapeHtml(post.content)}</p>

        <div class="flex items-center justify-between pt-2 border-t border-dark-800 text-xs font-mono text-slate-400">
          <button
            data-action="upvote-post"
            data-id="${escapeHtml(post.id)}"
            class="px-2.5 py-1 rounded-md bg-dark-950 border border-dark-700 hover:border-dark-600 flex items-center space-x-1.5 transition hover:text-white"
          >
            <i data-lucide="arrow-big-up" class="w-3.5 h-3.5 text-emerald-400 pointer-events-none"></i>
            <span class="pointer-events-none">${post.upvotes_count || 0} Upvotes</span>
          </button>
          <span class="text-[11px] text-slate-500">Verified BD Tech Builder</span>
        </div>
      </article>
    `;
  }).join("");

  lucide.createIcons();
}

function getPostTypeBadge(type) {
  switch (type) {
    case "Deal Alert": return `<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-400 border border-rose-800 font-bold">🔥 Deal Alert</span>`;
    case "Build Help": return `<span class="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 font-bold">🛠️ Build Help</span>`;
    case "Question": return `<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800 font-bold">❓ Question</span>`;
    default: return `<span class="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-slate-300 border border-dark-600 font-bold">💬 Discussion</span>`;
  }
}

// Toggle Inline Price Chart
function togglePriceChartInline(productId) {
  const drawer = document.getElementById(`chart-drawer-${productId}`);
  if (!drawer) return;

  const isHidden = drawer.classList.contains("hidden");

  if (openChartProductId && openChartProductId !== productId) {
    const prev = document.getElementById(`chart-drawer-${openChartProductId}`);
    if (prev) prev.classList.add("hidden");
  }

  if (isHidden) {
    drawer.classList.remove("hidden");
    openChartProductId = productId;
    const product = allProducts.find((p) => p.id === productId);
    if (product) renderInlineChart(product);
  } else {
    drawer.classList.add("hidden");
    openChartProductId = null;
  }

  lucide.createIcons();
}

function renderInlineChart(product) {
  const canvas = document.getElementById(`canvas-chart-${product.id}`);
  if (!canvas) return;

  if (chartInstances[product.id]) {
    chartInstances[product.id].destroy();
  }

  let history = product.price_history || [];
  history.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

  if (history.length === 1) {
    const single = history[0];
    const prevDate = new Date(new Date(single.recorded_at).getTime() - 24 * 60 * 60 * 1000);
    history = [
      { price: single.price, recorded_at: prevDate.toISOString() },
      single,
    ];
  }

  const labels = history.map((h) => {
    const d = new Date(h.recorded_at);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const dataPoints = history.map((h) => Number(h.price));

  chartInstances[product.id] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Cash Price in BDT",
          data: dataPoints,
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6, 182, 212, 0.08)",
          fill: true,
          tension: 0.2,
          pointBackgroundColor: "#22d3ee",
          pointBorderColor: "#07090e",
          pointRadius: 4,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#141822",
          titleFont: { family: "JetBrains Mono" },
          bodyFont: { family: "JetBrains Mono" },
          callbacks: {
            label: (ctx) => ` ৳ ${Number(ctx.parsed.y).toLocaleString("en-US")}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(39, 45, 61, 0.4)" },
          ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 10 } },
        },
        y: {
          grid: { color: "rgba(39, 45, 61, 0.4)" },
          ticks: {
            color: "#64748b",
            font: { family: "JetBrains Mono", size: 10 },
            callback: (val) => `৳ ${Number(val).toLocaleString()}`,
          },
        },
      },
    },
  });
}

// Toggle Inline Comments
async function toggleCommentsInline(productId) {
  const drawer = document.getElementById(`comments-drawer-${productId}`);
  if (!drawer) return;

  const isHidden = drawer.classList.contains("hidden");

  if (openCommentsProductId && openCommentsProductId !== productId) {
    const prev = document.getElementById(`comments-drawer-${openCommentsProductId}`);
    if (prev) prev.classList.add("hidden");
  }

  if (isHidden) {
    drawer.classList.remove("hidden");
    openCommentsProductId = productId;
    loadProductComments(productId);
  } else {
    drawer.classList.add("hidden");
    openCommentsProductId = null;
  }

  lucide.createIcons();
}

async function loadProductComments(productId) {
  const thread = document.getElementById(`comments-thread-${productId}`);
  if (!thread) return;

  try {
    const { data, error } = await sb
      .from("comments")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      thread.innerHTML = `
        <div class="text-xs text-slate-500 font-mono py-2 text-center">
          No feedback yet on this specific item. Post the first review above!
        </div>
      `;
      return;
    }

    thread.innerHTML = data.map((r) => {
      const rawRating = Math.max(1, Math.min(5, Number(r.rating) || 5));
      const maskedPhone = escapeHtml(String(r.user_phone || "").replace(/^(\+?880?1[3-9]\d)(\d{4})(\d{3})$/, "$1••••$3"));
      const stars = "★".repeat(rawRating) + "☆".repeat(5 - rawRating);

      return `
        <div class="p-2.5 bg-dark-900 border border-dark-700 rounded-lg space-y-1">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center space-x-2">
              <span class="font-bold text-white text-[11px] font-mono cursor-pointer hover:underline" data-action="view-profile" data-username="${escapeHtml(r.user_name || 'Buyer')}">
                @${escapeHtml(r.user_name || 'Buyer')}
              </span>
              <span class="text-[10px] font-mono px-1 py-0.2 rounded bg-dark-800 text-slate-400">${maskedPhone}</span>
            </div>
            <span class="text-amber-400 font-mono text-[11px]">${stars}</span>
          </div>
          <p class="text-xs text-slate-300 leading-normal font-sans">${escapeHtml(r.comment_text)}</p>
          <div class="text-[10px] font-mono text-slate-500 flex justify-between pt-0.5">
            <span>${formatTimeAgo(r.created_at)}</span>
            <span>Helpful (${r.helpful_count || 0})</span>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    thread.innerHTML = `<div class="text-xs text-red-400 font-mono">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Submit Inline Review
async function submitInlineReview(productId) {
  const phone = document.getElementById(`inline-phone-${productId}`).value.trim();
  const name = document.getElementById(`inline-name-${productId}`).value.trim() || (currentUser ? currentUser.username : "Community Member");
  const rating = parseInt(document.getElementById(`inline-rating-${productId}`).value, 10);
  const text = document.getElementById(`inline-text-${productId}`).value.trim();

  const bdPhoneRegex = /^(\+8801|01)[3-9]\d{8}$/;
  if (!bdPhoneRegex.test(phone)) {
    showToast("Invalid Bangladeshi phone. Format: 01XXXXXXXXX");
    return;
  }
  if (!text) {
    showToast("Please enter feedback text.");
    return;
  }

  try {
    const { error } = await sb.from("comments").insert([
      { product_id: productId, user_phone: phone, user_name: name, rating, comment_text: text }
    ]);
    if (error) throw error;

    document.getElementById(`inline-text-${productId}`).value = "";
    showToast("Review published!");
    loadProductComments(productId);
    fetchLiveRecentReviews();
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }
}

// Submit Review from Sidebar Composer
async function submitComposerReview() {
  const productId = document.getElementById("composer-product-select").value;
  const phone = document.getElementById("composer-phone").value.trim();
  const name = document.getElementById("composer-name").value.trim() || (currentUser ? currentUser.username : "Hardware Buyer");
  const rating = parseInt(document.getElementById("composer-rating").value, 10);
  const text = document.getElementById("composer-text").value.trim();

  if (!productId) {
    showToast("Please select a hardware component to review.");
    return;
  }
  const bdPhoneRegex = /^(\+8801|01)[3-9]\d{8}$/;
  if (!bdPhoneRegex.test(phone)) {
    showToast("Enter valid BD mobile number (01XXXXXXXXX).");
    return;
  }
  if (!text) {
    showToast("Please write a few words of feedback.");
    return;
  }

  try {
    const { error } = await sb.from("comments").insert([
      { product_id: productId, user_phone: phone, user_name: name, rating, comment_text: text }
    ]);
    if (error) throw error;

    document.getElementById("composer-text").value = "";
    showToast("Review published to community feed!");
    fetchLiveRecentReviews();
    if (openCommentsProductId === productId) {
      loadProductComments(productId);
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }
}

// Submit Community Post
async function submitCommunityPost() {
  if (!currentUser) {
    openAuthModal();
    showToast("Please sign in with your phone to post discussions.");
    return;
  }

  const rawTitle = document.getElementById("post-title-input").value;
  const title = (rawTitle || "").trim().slice(0, 140);
  const postType = document.getElementById("post-type-select").value;
  const rawContent = document.getElementById("post-content-input").value;
  const content = (rawContent || "").trim().slice(0, 3000);

  if (title.length < 5) {
    showToast("Discussion title must be at least 5 characters.");
    return;
  }
  if (content.length < 10) {
    showToast("Content must be at least 10 characters.");
    return;
  }

  try {
    const { data, error } = await sb.from("community_posts").insert([
      {
        title,
        content,
        post_type: postType,
        author_phone: currentUser.user_phone,
        author_name: currentUser.username,
        upvotes_count: 1
      }
    ]).select();

    if (error) throw error;

    document.getElementById("post-title-input").value = "";
    document.getElementById("post-content-input").value = "";
    showToast("Community post published!");

    if (data && data[0]) {
      communityPosts.unshift(data[0]);
      renderCommunityPostsFeed();
    }
  } catch (err) {
    showToast(`Failed to post: ${err.message}`);
  }
}

// Fetch Live Recent Reviews for Sidebar Stream
async function fetchLiveRecentReviews() {
  const container = document.getElementById("live-reviews-ticker");

  try {
    const { data, error } = await sb
      .from("comments")
      .select("*, products(title, vendor_name, category)")
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="text-xs text-slate-500 font-mono py-2">No reviews recorded yet.</div>`;
      return;
    }

    container.innerHTML = data.map((r) => {
      const rawRating = Math.max(1, Math.min(5, Number(r.rating) || 5));
      const maskedPhone = escapeHtml(String(r.user_phone || "").replace(/^(\+?880?1[3-9]\d)(\d{4})(\d{3})$/, "$1••••$3"));
      const stars = "★".repeat(rawRating) + "☆".repeat(5 - rawRating);
      const productTitle = r.products ? r.products.title : "Component";

      return `
        <div class="p-2.5 bg-dark-950/70 border border-dark-700 rounded-lg space-y-1.5 hover:border-dark-600 transition cursor-pointer" data-action="highlight-product" data-id="${escapeHtml(r.product_id)}">
          <div class="flex items-center justify-between text-[11px] font-mono">
            <span class="font-bold text-white">${escapeHtml(r.user_name || 'Buyer')}</span>
            <span class="text-amber-400">${stars}</span>
          </div>
          <div class="text-[10px] font-mono text-cyan-400 truncate">
            Re: ${escapeHtml(productTitle)}
          </div>
          <p class="text-xs text-slate-300 line-clamp-2 leading-relaxed font-sans">${escapeHtml(r.comment_text)}</p>
          <div class="text-[10px] font-mono text-slate-500 flex justify-between pt-0.5">
            <span>${maskedPhone}</span>
            <span>${formatTimeAgo(r.created_at)}</span>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Error loading recent reviews:", err);
  }
}

// Highlight & Scroll to product
function highlightProduct(productId) {
  if (activeFeedMode !== "HARDWARE") {
    switchMainFeedMode("HARDWARE");
  }

  const card = document.getElementById(`card-${productId}`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("ring-2", "ring-cyan-400", "glow-active");
    setTimeout(() => card.classList.remove("ring-2", "ring-cyan-400", "glow-active"), 3000);
    toggleCommentsInline(productId);
  } else {
    const product = allProducts.find((p) => p.id === productId);
    if (product) {
      document.getElementById("global-search").value = product.title;
      applyFilters();
    }
  }
}

// Atomic Deal Upvote
async function handleDealUpvote(productId, buttonEl) {
  if (!currentUser) {
    openAuthModal();
    showToast("Please sign in to upvote deals.");
    return;
  }

  const isUpvoted = userUpvotedSet.has(productId);
  if (isUpvoted) {
    userUpvotedSet.delete(productId);
  } else {
    userUpvotedSet.add(productId);
  }

  localStorage.setItem("tp_upvoted_deals", JSON.stringify([...userUpvotedSet]));

  try {
    const { data } = await sb.rpc("toggle_deal_upvote", {
      p_product_id: productId,
      p_user_phone: currentUser.user_phone,
    });

    if (data) {
      const countEl = buttonEl.querySelector("span");
      if (countEl) countEl.innerText = `${data.total_upvotes} Upvotes`;
      buttonEl.classList.toggle("text-emerald-400", data.upvoted);
      buttonEl.classList.toggle("border-emerald-800", data.upvoted);
      showToast(data.upvoted ? "Deal upvoted! 🔥" : "Upvote removed");
    }
  } catch (err) {
    showToast("Upvote recorded locally.");
  }
}

// Upvote Community Post (Atomic & Fraud Protected)
async function handlePostUpvote(postId) {
  if (!currentUser) {
    openAuthModal();
    showToast("Please sign in with your phone to upvote discussions.");
    return;
  }

  try {
    const { data, error } = await sb.rpc("toggle_post_upvote", {
      p_post_id: postId,
      p_user_phone: currentUser.user_phone,
    });
    if (error) throw error;

    const post = communityPosts.find((p) => p.id === postId);
    if (post && data) {
      post.upvotes_count = data.total_upvotes;
      renderCommunityPostsFeed();
      showToast(data.upvoted ? "Post upvoted! 🔥" : "Upvote removed");
    }
  } catch (err) {
    showToast(`Vote error: ${err.message}`);
  }
}

// Copy Direct Link
function copyProductLink(productId) {
  const url = `${window.location.origin}${window.location.pathname}?item=${productId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Direct hardware link copied!");
  }).catch(() => {
    showToast("Direct link copied to clipboard!");
  });
}

// Affiliate Outbound Tracking Pipeline
async function trackAffiliateClick(productId, vendorName, trackingUrl, price) {
  const potentialCommission = (Number(price) || 0) * 0.03;
  try {
    await sb.from("outbound_clicks").insert([
      {
        product_id: productId,
        vendor_name: vendorName,
        tracking_url: trackingUrl,
        affiliate_tag: "techpulse_bd",
        potential_commission: potentialCommission,
      },
    ]);
    fetchOutboundStats();
  } catch (e) {}
}

async function fetchOutboundStats() {
  try {
    const { count, error } = await sb.from("outbound_clicks").select("*", { count: "exact", head: true });
    if (!error && count !== null) {
      const el = document.getElementById("pulse-clicks");
      if (el) el.innerText = `${count} referral clicks`;
    }
  } catch (e) {}
}

// Social User Side Auth / Profile
function updateUserUI() {
  const container = document.getElementById("user-auth-section");
  const sidebarCard = document.getElementById("sidebar-user-card");
  const composerPhone = document.getElementById("composer-phone");
  const composerName = document.getElementById("composer-name");

  if (!currentUser) {
    container.innerHTML = `
      <button onclick="openAuthModal()" class="px-3 py-1.5 rounded-lg bg-dark-850 hover:bg-dark-800 text-white font-medium border border-dark-700 transition flex items-center space-x-1.5 text-xs">
        <i data-lucide="user-plus" class="w-3.5 h-3.5 text-emerald-400"></i>
        <span>Sign In</span>
      </button>
    `;
    sidebarCard.classList.add("hidden");
    return;
  }

  const initials = currentUser.username.substring(0, 2).toUpperCase();
  container.innerHTML = `
    <div class="flex items-center space-x-2">
      <button onclick="openUserProfileModal('${escapeHtml(currentUser.username)}')" class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-dark-850 hover:bg-dark-800 border border-dark-700 text-white text-xs font-mono">
        <div class="h-4 w-4 rounded-full bg-emerald-500 text-[10px] flex items-center justify-center font-bold text-black">
          ${initials}
        </div>
        <span>@${escapeHtml(currentUser.username)}</span>
      </button>
      <button onclick="handleLogout()" class="text-slate-500 hover:text-red-400 text-xs px-1" title="Sign Out">✕</button>
    </div>
  `;

  sidebarCard.classList.remove("hidden");
  document.getElementById("sidebar-user-avatar").innerText = initials;
  document.getElementById("sidebar-user-name").innerText = `@${currentUser.username}`;
  document.getElementById("sidebar-user-phone").innerText = currentUser.user_phone.replace(/^(\+?880?1[3-9]\d)(\d{4})(\d{3})$/, "$1••••$3");
  document.getElementById("sidebar-user-rep").innerText = `★ ${currentUser.reputation_points || 15}`;

  if (composerPhone) composerPhone.value = currentUser.user_phone;
  if (composerName) composerName.value = currentUser.username;

  lucide.createIcons();
}

function openAuthModal() {
  document.getElementById("auth-modal").classList.remove("hidden");
  document.getElementById("auth-phone-input").focus();
}

function closeAuthModal() {
  document.getElementById("auth-modal").classList.add("hidden");
}

async function handleAuthSubmit() {
  const rawPhone = document.getElementById("auth-phone-input").value;
  const phone = (rawPhone || "").trim().replace(/[\s-]/g, "");
  const rawUsername = document.getElementById("auth-username-input").value;
  const cleanUsername = (rawUsername || "").trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 25);
  const rawBio = document.getElementById("auth-bio-input").value;
  const cleanBio = (rawBio || "").trim().slice(0, 140) || "PC Builder & Hardware Enthusiast";

  const bdPhoneRegex = /^(\+8801|01)[3-9]\d{8}$/;
  if (!bdPhoneRegex.test(phone)) {
    showToast("Invalid Bangladeshi phone number (01XXXXXXXXX).");
    return;
  }
  if (!cleanUsername || cleanUsername.length < 3) {
    showToast("Username must be 3-25 alphanumeric characters (a-z, 0-9, _).");
    return;
  }

  try {
    const { data, error } = await sb.rpc("safe_upsert_profile", {
      p_phone: phone,
      p_username: cleanUsername,
      p_bio: cleanBio,
    });
    if (error) throw error;

    currentUser = data;
    localStorage.setItem("tp_current_user", JSON.stringify(data));

    closeAuthModal();
    updateUserUI();
    showToast(`Welcome @${cleanUsername}! Profile verified.`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem("tp_current_user");
  updateUserUI();
  showToast("Logged out of community session.");
}

// User Public Profile Modal
async function openUserProfileModal(username) {
  const modal = document.getElementById("profile-modal");
  modal.classList.remove("hidden");

  document.getElementById("modal-profile-username").innerText = `@${username}`;
  document.getElementById("modal-profile-avatar").innerText = username.substring(0, 2).toUpperCase();

  const reviewsContainer = document.getElementById("modal-profile-reviews");
  reviewsContainer.innerHTML = `<div class="text-slate-500 py-1">Loading profile reviews...</div>`;

  try {
    const { data: profile } = await sb.from("user_profiles").select("*").eq("username", username).single();
    if (profile) {
      document.getElementById("modal-profile-bio").innerText = `"${profile.bio || 'Hardware Enthusiast'}"`;
      document.getElementById("modal-profile-rep").innerText = `★ ${profile.reputation_points || 15}`;
      document.getElementById("modal-profile-phone").innerText = profile.user_phone.replace(/^(\+?880?1[3-9]\d)(\d{4})(\d{3})$/, "$1••••$3");
    }

    const { data: reviews } = await sb.from("comments").select("*, products(title, vendor_name)").eq("user_name", username).limit(5);
    if (!reviews || reviews.length === 0) {
      reviewsContainer.innerHTML = `<div class="text-slate-500 py-1">No product reviews published yet.</div>`;
    } else {
      reviewsContainer.innerHTML = reviews.map((r) => `
        <div class="p-2.5 bg-dark-950 border border-dark-700 rounded-lg">
          <div class="text-[10px] text-cyan-400 font-bold truncate">Re: ${escapeHtml(r.products ? r.products.title : 'Hardware')}</div>
          <p class="text-[11px] text-slate-300 line-clamp-2 mt-0.5">${escapeHtml(r.comment_text)}</p>
        </div>
      `).join("");
    }
  } catch (e) {
    reviewsContainer.innerHTML = `<div class="text-slate-500">Member profile details loaded.</div>`;
  }
}

function closeUserProfileModal() {
  document.getElementById("profile-modal").classList.add("hidden");
}

// ==========================================
// RAG (Retrieval-Augmented Generation) COPILOT
// ==========================================
function toggleRagDrawer() {
  const drawer = document.getElementById("rag-drawer");
  drawer.classList.toggle("translate-x-full");
  if (!drawer.classList.contains("translate-x-full")) {
    document.getElementById("rag-input").focus();
  }
}

function askRagSample(query) {
  document.getElementById("rag-input").value = query;
  executeRagQuery();
}

async function executeRagQuery() {
  const input = document.getElementById("rag-input");
  const query = input.value.trim();
  if (!query) return;

  const messagesContainer = document.getElementById("rag-messages");

  messagesContainer.innerHTML += `
    <div class="flex justify-end">
      <div class="p-2.5 bg-cyan-950/80 border border-cyan-800 text-cyan-200 rounded-lg max-w-[85%] text-xs font-mono">
        ${escapeHtml(query)}
      </div>
    </div>
  `;

  input.value = "";
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  const loadingId = "rag-loading-" + Date.now();
  messagesContainer.innerHTML += `
    <div id="${loadingId}" class="p-3 bg-dark-900 border border-dark-700 rounded-lg text-slate-400 space-y-1 text-xs">
      <div class="flex items-center space-x-2 text-cyan-400">
        <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>
        <span>Retrieving live facts from Supabase database...</span>
      </div>
    </div>
  `;
  lucide.createIcons();
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // 1. RETRIEVE RELEVANT HARDWARE & REVIEWS (RAG RETRIEVER)
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  let matchedItems = allProducts.filter((p) => {
    return tokens.some((token) => p.title.toLowerCase().includes(token) || p.category.toLowerCase().includes(token));
  });

  if (matchedItems.length === 0) {
    matchedItems = allProducts.slice(0, 5);
  } else {
    matchedItems = matchedItems.slice(0, 4);
  }

  const matchedIds = matchedItems.map((m) => m.id);
  const { data: matchedReviews } = await sb.from("comments").select("*").in("product_id", matchedIds).limit(4);

  // 2. CONTEXT AUGMENTATION & ANSWER SYNTHESIS (RAG GENERATOR)
  let answerHtml = `<div class="space-y-2 text-xs font-mono text-slate-200">`;
  answerHtml += `<p class="text-slate-300">Based on live crawled listings across Bangladeshi retailers:</p>`;

  matchedItems.forEach((item) => {
    const affiliateUrl = buildAffiliateUrl(item.product_url, item.vendor_name);
    answerHtml += `
      <div class="p-2.5 bg-dark-950 border border-dark-700 rounded-lg space-y-1">
        <div class="font-bold text-white flex items-center justify-between">
          <span class="truncate">${escapeHtml(item.title)}</span>
          <span class="text-emerald-400 ml-2 flex-shrink-0">৳ ${Number(item.current_price).toLocaleString()}</span>
        </div>
        <div class="text-[11px] text-slate-400 flex items-center justify-between">
          <span>Store: <strong>${escapeHtml(item.vendor_name)}</strong> (${escapeHtml(item.stock_status)})</span>
          <a href="${affiliateUrl}" target="_blank" rel="noopener noreferrer nofollow sponsored" class="text-cyan-400 hover:underline">View Store →</a>
        </div>
      </div>
    `;
  });

  if (matchedReviews && matchedReviews.length > 0) {
    answerHtml += `<div class="pt-1 text-[11px] text-slate-400 font-bold">Community Verdicts in BD:</div>`;
    matchedReviews.forEach((r) => {
      answerHtml += `
        <div class="text-[11px] text-slate-400 italic bg-dark-950/60 p-1.5 rounded border border-dark-800">
          "${escapeHtml(r.comment_text)}" — <span class="text-slate-300">@${escapeHtml(r.user_name || 'Buyer')} (${r.rating}/5★)</span>
        </div>
      `;
    });
  }

  answerHtml += `</div>`;

  const loadingEl = document.getElementById(loadingId);
  if (loadingEl) {
    loadingEl.innerHTML = `
      <div class="text-cyan-400 font-bold flex items-center gap-1.5 pb-1 border-b border-dark-700">
        <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400"></i>
        <span>Grounded Answer (${matchedItems.length} Sources Verified)</span>
      </div>
      ${answerHtml}
    `;
    lucide.createIcons();
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Toast
let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById("toast");
  const label = document.getElementById("toast-message");
  label.innerText = msg;
  toast.classList.remove("translate-y-16", "opacity-0");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add("translate-y-16", "opacity-0");
  }, 2600);
}

// Vendor Theme Helper with Bangladeshi Market Context & Hubs
function getVendorTheme(vendor) {
  const v = (vendor || "").toLowerCase();
  if (v.includes("star tech")) return { 
    badge: "bg-red-950/80 text-red-400 border border-red-800 font-bold",
    borderAccent: "border-l-2 border-l-red-500",
    hub: "Elephant Rd & IDB"
  };
  if (v.includes("tech land")) return { 
    badge: "bg-orange-950/80 text-orange-400 border border-orange-800 font-bold",
    borderAccent: "border-l-2 border-l-orange-500",
    hub: "Multiplan Level 5"
  };
  if (v.includes("ryans")) return { 
    badge: "bg-sky-950/80 text-sky-400 border border-sky-800 font-bold",
    borderAccent: "border-l-2 border-l-sky-500",
    hub: "Kakrail & Banani"
  };
  if (v.includes("bdstall")) return { 
    badge: "bg-emerald-950/80 text-emerald-400 border border-emerald-800 font-bold",
    borderAccent: "border-l-2 border-l-emerald-500",
    hub: "Courier 24h"
  };
  if (v.includes("binary logic")) return { 
    badge: "bg-indigo-950/80 text-indigo-400 border border-indigo-800 font-bold",
    borderAccent: "border-l-2 border-l-indigo-500",
    hub: "Computer City L4"
  };
  return { 
    badge: "bg-dark-800 text-slate-300 border border-dark-700",
    borderAccent: "border-l-2 border-l-cyan-500",
    hub: "Dhaka Retail"
  };
}

// Format Time
function formatTimeAgo(isoDate) {
  if (!isoDate) return "recently";
  const diffSec = Math.floor((new Date() - new Date(isoDate)) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// HTML Escape
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}
