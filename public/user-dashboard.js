// Extract query parameters from URL
const urlParams = new URLSearchParams(window.location.search)
const telegramId = urlParams.get("userId")

if (!telegramId) {
  document.body.innerHTML = '<main class="container"><p class="empty">Missing userId in URL.</p></main>'
  throw new Error("Missing userId")
}

// DOM references
const userNameHeading = document.getElementById("user-name")
const tournamentInfoDiv = document.getElementById("tournament-info")
const matchesList = document.getElementById("matches-list")
const matchesEmpty = document.getElementById("matches-empty")
const historyList = document.getElementById("history-list")
const historyEmpty = document.getElementById("history-empty")

// Stats
const statUpcoming = document.getElementById("stat-upcoming")
const statActive = document.getElementById("stat-active")
const statCompleted = document.getElementById("stat-completed")

// Profile
const profileName = document.getElementById("profile-name")
const profileTournament = document.getElementById("profile-tournament")
const profileBalance = document.getElementById("profile-balance")
const profileType = document.getElementById("profile-type")

// Tabs
const tabButtons = Array.from(document.querySelectorAll(".tab"))
const panels = Array.from(document.querySelectorAll(".panel"))

// Results DOM
const resultsGroups = document.getElementById("results-groups")
const resultsEmpty = document.getElementById("results-empty")
const resultsSkeleton = document.getElementById("results-skeleton")
const outcomeChips = Array.from(document.querySelectorAll(".chip"))
const resultsTournamentFilter = document.getElementById("results-tournament-filter")
const resultsSearch = document.getElementById("results-search")
const resultsSort = document.getElementById("results-sort")
const resultsRefresh = document.getElementById("results-refresh")

const tournamentTypeNav = document.getElementById("tournament-type-nav");
const typeButtons = Array.from(document.querySelectorAll(".type-btn"));





function activateTab(tab) {
  const key = tab.dataset.tab
  tabButtons.forEach((b) => b.classList.toggle("active", b === tab))
  panels.forEach((p) => p.classList.toggle("active", p.id === `panel-${key}`))
  tabButtons.forEach((b) => b.setAttribute("aria-selected", b === tab ? "true" : "false"))
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn))
})





// Helpers
function fmtDate(dt) {
  if (!dt) return "—";
  let d;
  if (typeof dt === "number") {
    d = new Date(dt);
  } else if (/^\d+$/.test(dt)) {
    // numeric string timestamp
    d = new Date(parseInt(dt, 10));
  } else {
    d = new Date(dt);
  }
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}


//clear board
function clearDashboardUI() {
  userNameHeading.textContent = ""
  tournamentInfoDiv.textContent = ""

  matchesList.innerHTML = ""
  matchesEmpty.hidden = true

  historyList.innerHTML = ""
  historyEmpty.hidden = true

  statUpcoming.textContent = "0"
  statActive.textContent = "0"
  statCompleted.textContent = "0"

  profileName.textContent = ""
  profileTournament.textContent = ""
  profileBalance.textContent = ""
  profileType.textContent = ""
}



function withinWindow(tsMs, windowMinutes = 5) {
  const now = Date.now()
  return now >= tsMs && now < tsMs + windowMinutes * 60 * 1000
}

function getInitials(nameOrHandle) {
  if (!nameOrHandle) return "?"
  const s = String(nameOrHandle).replace(/^@/, "").trim()
  const parts = s.split(" ").filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function isDrawItem(item) {
  // Compatible with both shapes
  if (typeof item.isDraw === "boolean") return item.isDraw
  // Heuristic: draw when no explicit winner/loser in payload strings
  const hasWinner = item.winner && item.winner !== "—"
  const hasLoser = item.loser && item.loser !== "—"
  return !hasWinner && !hasLoser
}

function normalizeOutcome(item) {
  const draw = isDrawItem(item)
  if (draw) return "draw"
  return item.youWon ? "win" : "loss"
}

function opponentName(item) {
  const draw = isDrawItem(item);
  if (draw) {
    // Prefer loser (if present), else winner; else blank
    return item.loser && item.loser !== "—" ? item.loser : item.winner && item.winner !== "—" ? item.winner : "";
  }
  // If youWon, opponent is loser; else opponent is winner
  return item.youWon ? item.loser || "" : item.winner || "";
}
function buildMatchCard(match, idx, userName) {
  // Check if the current user is in this match
  const youAreIn = match.player1 === userName || match.player2 === userName;

  // Map fixture status to badge label and CSS class
  const statusBadgeMap = {
    pending: { label: "Pending", className: "wait" },
    scheduled: { label: "Scheduled", className: "wait" },
    waiting: { label: "Waiting", className: "wait" },
    in_progress: { label: "In Progress", className: "ready" },
    completed: { label: "Completed", className: "done" },
  };

  // Determine actual status dynamically
  let status = match.status || "pending";
  const now = Date.now();
  if (match.matchTime) {
    const matchTimeMs = new Date(match.matchTime).getTime();
    if (status !== "completed" && matchTimeMs > now) {
      status = "scheduled"; // Scheduled but not reached
    } else if (status !== "completed" && matchTimeMs <= now) {
      status = "in_progress"; // Match time reached
    }
  }

  const badgeInfo = statusBadgeMap[status] || statusBadgeMap.pending;

  // Create badge HTML with proper label and styling
  const headerBadge = `<span class="badge ${badgeInfo.className}">${badgeInfo.label}</span>`;

  // Determine button label and disabled state based on status and matchTime
  let buttonLabel = match.roomId ? "Play" : "Create & Play";
  let buttonDisabled = false;

  // Disable if matchTime is missing
  if (!match.matchTime) {
    buttonLabel = "Not Scheduled";
    buttonDisabled = true;
  }

  // Disable if completed
  if (status === "completed") {
    buttonLabel = "Completed";
    buttonDisabled = true;
  }

  // Disable if scheduled but time not reached
  if (status === "scheduled") {
    buttonDisabled = true;
  }

  // Play button is enabled only if user is in this match and not disabled
  const playBtn = youAreIn
    ? `<button class="btn primary play-btn" data-fixture-id="${match.fixtureId}" ${buttonDisabled ? "disabled" : ""}>${buttonLabel}</button>`
    : `<button class="btn primary" disabled title="Not your match">Not Allowed</button>`;

  return `
    <article role="listitem" aria-labelledby="match-${idx + 1}">
      <div class="match-header">
        <h3 id="match-${idx + 1}" class="muted">Match #${idx + 1}</h3>
        ${headerBadge}
      </div>
      <div class="players">
        <div class="player">${match.player1}</div>
        <div class="vs">vs</div>
        <div class="player">${match.player2 || "BYE"}</div>
      </div>
      <div class="match-time">Time: ${match.matchTime ? fmtDate(match.matchTime) : "Not scheduled"}</div>
      <div class="actions">
        ${playBtn}
        <button class="btn secondary copy-link-btn" data-fixture-id="${match.fixtureId}">Copy Link</button>
      </div>
    </article>
  `;
}

function buildHistoryCard(match, idx, userName) {
  const statusText = match.status || 'Unknown';
  const statusTag = `<span class="tag status">${statusText}</span>`;

  // Get the result or score, fallback to "N/A" if not present
  const resultText = match.result || match.score || "N/A";

  return `
  <article role="listitem" aria-labelledby="hist-${idx + 1}">
    <div class="match-header">
      <h3 id="hist-${idx + 1}" class="muted">
        Match #${idx + 1} • ${fmtDate(match.matchTime || match.createdAt)}
      </h3>
      ${statusTag}
    </div>
    <div class="players">
      <div class="player">${match.player1}</div>
      <div class="vs">vs</div>
      <div class="player">${match.player2 || "BYE"}</div>
    </div>
    <div class="match-result">
      <strong>Result:</strong> ${resultText}
    </div>
  </article>
  `;
}


// New: Cool Results group UI
function resultBadge(outcome) {
  if (outcome === "draw") return '<span class="tag draw">Draw</span>'
  if (outcome === "win") return '<span class="tag win">Win</span>'
  return '<span class="tag loss">Loss</span>'
}

function renderResultsGroups(items) {
  resultsGroups.innerHTML = ""
  resultsEmpty.hidden = true

  if (!items.length) {
    resultsEmpty.hidden = false
    return
  }

  // Group by tournament uniqueId
  const groups = items.reduce((acc, it) => {
    const key = it.tournament?.uniqueId || "Unknown"
    if (!acc[key]) acc[key] = []
    acc[key].push(it)
    return acc
  }, {})

  Object.entries(groups).forEach(([code, arr], i) => {
    // Sort within group by date DESC by default (outer flow already sorted by UI control)
    const type = arr[0]?.tournament?.type || "N/A"
    const balance = arr[0]?.tournament?.balance ?? 0

    const group = document.createElement("div")
    group.className = "group"
    group.innerHTML = `
      <div class="group-header" role="button" aria-expanded="true" tabindex="0">
        <div class="group-title">${code} • ${type} • ${balance} Birr</div>
        <div class="group-meta">${arr.length} match${arr.length > 1 ? "es" : ""}</div>
      </div>
      <div class="group-body"></div>
    `
    const body = group.querySelector(".group-body")

    arr.forEach((res, idx) => {
      const outcome = normalizeOutcome(res)
      const opp = opponentName(res) || "Opponent"
      const when = res.date ? fmtDate(res.date) : "—"
      const middle = outcome === "draw" ? "draw" : "def."


      const article = document.createElement("article")
      article.className = "result-card"
      article.setAttribute("role", "listitem")
      article.innerHTML = `
        <div class="result-top">
          <div class="result-title">${code}</div>
          ${resultBadge(outcome)}
        </div>
        <div class="result-main">
          <div class="avatar">${getInitials(opp)}</div>
          <div class="opp">
            <div class="opp-name">${opp || "—"}</div>
            <div class="opp-sub">
              ${outcome === "win" ? "You " : outcome === "loss" ? "You " : ""}${middle}
              ${outcome === "draw" ? "" : opp || "opponent"}
              ${res.score && res.score !== "-" ? ` • ${res.score}` : ""}
            </div>
          </div>
        </div>
        <div class="result-foot">
          <div>${when}</div>
          <div>${res.tournament?.type || "N/A"} • ${res.tournament?.balance ?? 0} Birr</div>
        </div>
      `
      body.appendChild(article)
    })

    // Collapse toggle
    const header = group.querySelector(".group-header")
    const bodyEl = group.querySelector(".group-body")
    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true"
      header.setAttribute("aria-expanded", expanded ? "false" : "true")
      bodyEl.style.display = expanded ? "none" : "grid"
    })
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        header.click()
      }
    })

    resultsGroups.appendChild(group)
  })
}

// Results state + filtering
let resultsRaw = [] // original payload

function applyResultsFilters() {
  if (!Array.isArray(resultsRaw)) return

  // Outcome filter
  const activeChip = outcomeChips.find((c) => c.classList.contains("chip-active"))
  const outcome = activeChip ? activeChip.dataset.outcome : "all"

  // Tournament filter
  const tourFilter = resultsTournamentFilter.value || "all"

  // Search
  const q = (resultsSearch.value || "").trim().toLowerCase()

  // Sort
  const sort = resultsSort.value || "newest"

  let arr = resultsRaw.slice()

  // Filter by outcome
  if (outcome !== "all") {
    arr = arr.filter((r) => normalizeOutcome(r) === outcome)
  }

  // Filter by tournament
  if (tourFilter !== "all") {
    arr = arr.filter((r) => (r.tournament?.uniqueId || "N/A") === tourFilter)
  }

  // Search by opponent
  if (q) {
    arr = arr.filter((r) => (opponentName(r) || "").toLowerCase().includes(q))
  }

  // Sort
  arr.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return sort === "newest" ? db - da : da - db
  })

  renderResultsGroups(arr)
}

function populateTournamentFilter(items) {
  const set = new Set(items.map((r) => r.tournament?.uniqueId || "N/A"))
  resultsTournamentFilter.innerHTML = `<option value="all">All tournaments</option>`
  Array.from(set)
    .sort()
    .forEach((code) => {
      const opt = document.createElement("option")
      opt.value = code
      opt.textContent = code
      resultsTournamentFilter.appendChild(opt)
    })
}
async function loadDashboard() {
  try {
    console.log("Starting loadDashboard...");

    // Fetch all fixtures and tournaments for user
    const res = await fetch(`/api/user/${telegramId}/fixtures`);
    console.log("Fetch response status:", res.status);

    if (!res.ok) throw new Error(`Failed to fetch fixtures: ${res.status}`);

    const { user, tournaments, fixtures } = await res.json();
    console.log("User data:", user);
    console.log("Tournaments data:", tournaments);
    console.log("Fixtures data:", fixtures);

    // Remove finished fixture from list if present in URL
    const finishedFixtureId = new URLSearchParams(window.location.search).get("finishedFixtureId");
    if (finishedFixtureId) {
      const idx = fixtures.findIndex(f => f.fixtureId === finishedFixtureId);
      if (idx !== -1) fixtures.splice(idx, 1);
    }

    // Header + Hero + Profile setup
    userNameHeading.textContent = `Welcome, ${user.name}`;

    // Default tournament type filter
    let currentTypeFilter = "Silver";

    // DOM elements
    const tournamentIdInfoP = document.getElementById("tournament-id-info");
    const navButtons = document.querySelectorAll("#tournament-type-nav .nav-btn");

    // Function to render dashboard based on tournament type
    function renderDashboard(typeFilter) {
      currentTypeFilter = typeFilter;

      // Filter tournaments by type
      const matchedTournament = tournaments.find(t => t.type.toLowerCase() === typeFilter.toLowerCase());
      if (tournamentIdInfoP) {
        tournamentIdInfoP.textContent = matchedTournament
          ? `${matchedTournament.type} tournament id ${matchedTournament.uniqueId}`
          : "";
      }

      // Update profile info
      if (tournaments.length === 1) {
        const t = tournaments[0];
        tournamentInfoDiv.textContent = `${t.uniqueId} • ${t.type} • ${t.balance} Birr`;
        profileTournament.textContent = t.uniqueId;
        profileBalance.textContent = `${t.balance} Birr`;
        profileType.textContent = t.type;
      } else if (tournaments.length > 1) {
        tournamentInfoDiv.textContent = `${tournaments.length} tournaments joined`;
        profileTournament.textContent = "Multiple";
        profileBalance.textContent = "-";
        profileType.textContent = "-";
      } else {
        tournamentInfoDiv.textContent = "No tournaments";
        profileTournament.textContent = "-";
        profileBalance.textContent = "-";
        profileType.textContent = "-";
      }

      // Filter fixtures by type
      const filteredFixtures = fixtures.filter(f => f.tournament?.type?.toLowerCase() === typeFilter.toLowerCase());
      const now = Date.now();

      // Stats calculation
      const upcoming = filteredFixtures.filter(f => f.matchTime && new Date(f.matchTime).getTime() > now);
      const active = filteredFixtures.filter(f => f.matchTime && withinWindow(new Date(f.matchTime).getTime()));
      const completed = filteredFixtures.filter(f => f.result && f.result !== "" && f.result !== "pending");

      statUpcoming.textContent = upcoming.length;
      statActive.textContent = active.length;
      statCompleted.textContent = completed.length;

      // Highlight active filter button
      navButtons.forEach(btn => {
        if (btn.dataset.period.toLowerCase() === typeFilter.toLowerCase()) btn.classList.add("active");
        else btn.classList.remove("active");
      });

      // Render upcoming matches
      const upcomingFixtures = filteredFixtures.filter(f => f.status !== "completed");
      if (!upcomingFixtures.length) {
        matchesList.innerHTML = "";
        matchesEmpty.hidden = false;
      } else {
        matchesList.innerHTML = upcomingFixtures.map((m, i) => buildMatchCard(m, i, user.name)).join("");
        matchesEmpty.hidden = true;

        // Play button handlers
        document.querySelectorAll(".play-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const fixtureId = btn.getAttribute("data-fixture-id");
            const match = fixtures.find(f => f.fixtureId === fixtureId);
            if (!match) return alert("Match not found");
            const tournamentId = match.tournament?.uniqueId || "";
            window.location.href = `/game.html?fixtureId=${encodeURIComponent(fixtureId)}&userId=${encodeURIComponent(telegramId)}&tournamentId=${encodeURIComponent(tournamentId)}`;
          });
        });

        // Copy link button handlers
        document.querySelectorAll(".copy-link-btn").forEach(async btn => {
          btn.addEventListener("click", async () => {
            const fixtureId = btn.getAttribute("data-fixture-id");
            const url = `${window.location.origin}/game.html?fixtureId=${encodeURIComponent(fixtureId)}&userId=${encodeURIComponent(telegramId)}&tournamentId=${encodeURIComponent(matchedTournament?.uniqueId || "")}`;
            try {
              await navigator.clipboard.writeText(url);
              btn.textContent = "Copied!";
              setTimeout(() => (btn.textContent = "Copy Link"), 1000);
            } catch {
              alert(url);
            }
          });
        });
      }

      // Render history
      const history = filteredFixtures
        .filter(f => f.result && f.result !== "" && f.result !== "pending")
        .sort((a, b) => new Date(b.matchTime || b.createdAt) - new Date(a.matchTime || a.createdAt));

      if (!history.length) {
        historyList.innerHTML = "";
        historyEmpty.hidden = false;
      } else {
        historyList.innerHTML = history.map((m, i) => buildHistoryCard(m, i, user.name)).join("");
        historyEmpty.hidden = true;
      }
    }

    // Initial render
    renderDashboard(currentTypeFilter);

    // Set filter buttons to update dashboard dynamically
    navButtons.forEach(btn => {
      btn.addEventListener("click", () => renderDashboard(btn.dataset.period));
    });

  } catch (err) {
    console.error("Error loading dashboard:", err);
    matchesList.innerHTML = "";
    matchesEmpty.hidden = false;
    historyList.innerHTML = "";
    historyEmpty.hidden = false;
  }
}

// Show/hide loading skeleton
function showResultsSkeleton(show) {
  resultsSkeleton.hidden = !show;
  resultsGroups.innerHTML = "";
  resultsEmpty.hidden = true;
}

// Load user results
async function loadResults() {
  showResultsSkeleton(true)
  try {
    const r = await fetch(`/api/user/${telegramId}/results`)
    if (!r.ok) throw new Error("Failed to fetch results")
    const data = await r.json()

    const items = Array.isArray(data.results) ? data.results : []
    resultsRaw = items

    populateTournamentFilter(items)
    applyResultsFilters()
  } catch (e) {
    console.error("Error loading results:", e)
    resultsGroups.innerHTML = ""
    resultsEmpty.hidden = false
  } finally {
    showResultsSkeleton(false)
  }
}


// Wire filters
outcomeChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    outcomeChips.forEach((c) => c.classList.remove("chip-active"))
    chip.classList.add("chip-active")
    applyResultsFilters()
  })
})
resultsTournamentFilter.addEventListener("change", applyResultsFilters)
resultsSearch.addEventListener("input", () => {
  // debounce minimal
  clearTimeout(resultsSearch._tid)
  resultsSearch._tid = setTimeout(applyResultsFilters, 150)
})
resultsSort.addEventListener("change", applyResultsFilters)
resultsRefresh.addEventListener("click", loadResults)

// Top refresh only reloads fixtures panel
// Top refresh only reloads fixtures panel
const refreshBtn = document.getElementById("refresh-btn")
refreshBtn.addEventListener("click", () => {
  clearDashboardUI()   // Clear UI immediately before loading
  loadDashboard()
})

// Init
document.addEventListener("DOMContentLoaded", () => {
  activateTab(document.getElementById("tab-matches"))
  loadDashboard()
  loadResults()
})

