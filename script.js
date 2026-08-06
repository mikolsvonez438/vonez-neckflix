const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const PLAYER_BASE_URL = "https://player.videasy.to";

const state = {
  currentTvShow: null,
  spotlightItems: [],
  spotlightIndex: 0,
  spotlightTimer: null,
  toastTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function fetchJson(path) {
  if (window.location.protocol === "file:") {
    throw new Error(
      "Neckflix cannot run from a file:// address. Start start-local.cmd and open http://127.0.0.1:3000 instead.",
    );
  }

  const response = await fetch(`/api/tmdb?path=${encodeURIComponent(path)}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Catalog request failed (${response.status})`);
  }

  return response.json();
}

function imageUrl(path, size = "w500") {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : "";
}

function getTitle(item) {
  return item?.title || item?.name || "Untitled";
}

function getYear(item) {
  return (item?.release_date || item?.first_air_date || "").slice(0, 4) || "New";
}

function getMediaType(item, fallback = "movie") {
  return item?.media_type === "tv" || item?.media_type === "movie"
    ? item.media_type
    : fallback;
}

function getDetailUrl(item, fallbackType) {
  const type = getMediaType(item, fallbackType);
  return `detail.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(item.id)}`;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setHeaderBehavior() {
  const header = $("#siteHeader");
  if (!header) return;

  const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 24);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });
}

function createPoster(item, altText) {
  const poster = document.createElement("div");
  poster.className = "card-poster";

  if (item.poster_path) {
    const image = document.createElement("img");
    image.src = imageUrl(item.poster_path, "w500");
    image.alt = altText;
    image.loading = "lazy";
    image.decoding = "async";
    poster.appendChild(image);
  }

  return poster;
}

function buildCard(item, fallbackType = "movie", rank = null, options = {}) {
  const type = getMediaType(item, fallbackType);
  const title = getTitle(item);
  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${title}, ${type === "tv" ? "TV series" : "movie"}`);

  const poster = createPoster(item, `${title} poster`);
  if (rank) {
    const rankLabel = document.createElement("span");
    rankLabel.className = "card-rank";
    rankLabel.textContent = String(rank).padStart(2, "0");
    poster.appendChild(rankLabel);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const titleElement = document.createElement("div");
  titleElement.className = "card-title";
  titleElement.textContent = title;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.innerHTML = `<span>${getYear(item)}</span><span>•</span><span class="card-rating">★ ${Number(item.vote_average || 0).toFixed(1)}</span>`;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const pill = document.createElement("span");
  pill.className = `pill ${type === "tv" ? "pill-tv" : "pill-movie"}`;
  pill.textContent = type === "tv" ? "Series" : "Movie";

  const action = document.createElement("button");
  action.className = "card-play";
  action.type = "button";
  action.textContent = type === "tv" && options.episodeAction ? "＋" : "▶";
  action.setAttribute(
    "aria-label",
    type === "tv" && options.episodeAction ? `Browse episodes of ${title}` : `View ${title}`,
  );

  const openDetails = () => {
    window.location.href = getDetailUrl(item, type);
  };

  action.addEventListener("click", (event) => {
    event.stopPropagation();
    if (type === "tv" && options.episodeAction) {
      loadTvUiForShow(item);
    } else {
      openDetails();
    }
  });

  card.addEventListener("click", openDetails);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails();
    }
  });

  actions.append(pill, action);
  body.append(titleElement, meta, actions);
  card.append(poster, body);
  return card;
}

function createSkeletons() {
  const loading = $("#loadingState");
  if (!loading) return;

  loading.innerHTML = "";
  for (let index = 0; index < 6; index += 1) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    loading.appendChild(card);
  }
}

function setCatalogLoading(isLoading) {
  const loading = $("#loadingState");
  const catalog = $(".catalog");
  if (loading) loading.classList.toggle("hidden", !isLoading);
  if (catalog) catalog.setAttribute("aria-busy", String(isLoading));
}

function renderError(error) {
  const grid = $("#resultsGrid");
  if (!grid) return;

  grid.className = "";
  const isFileProtocol = window.location.protocol === "file:";
  grid.innerHTML = `
    <div class="error-state">
      <div><strong>${isFileProtocol ? "Start the local server first." : "We hit a plot twist."}</strong><span>${isFileProtocol ? "Run start-local.cmd, then open http://127.0.0.1:3000 in your browser." : "The catalog could not load. Check your connection and try again."}</span></div>
    </div>`;
  $("#resultsInfo").textContent = "Unable to load titles";
  console.error(error);
}

function renderHomeSection(title, items, mediaType, rankItems = false) {
  const resultsGrid = $("#resultsGrid");
  const section = document.createElement("section");
  section.className = "home-section";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "home-section-header";
  sectionHeader.innerHTML = `<h3 class="home-section-title"></h3><span class="row-count">${Math.min(items.length, 18)} TITLES</span>`;
  $(".home-section-title", sectionHeader).textContent = title;

  const wrapper = document.createElement("div");
  wrapper.className = "home-row-wrapper";

  const row = document.createElement("div");
  row.className = "home-row";
  row.setAttribute("aria-label", title);

  items.slice(0, 18).forEach((item, index) => {
    item.media_type = mediaType;
    row.appendChild(buildCard(item, mediaType, rankItems ? index + 1 : null, { episodeAction: mediaType === "tv" }));
  });

  const previous = document.createElement("button");
  previous.className = "home-nav-btn home-nav-btn-left";
  previous.type = "button";
  previous.textContent = "‹";
  previous.setAttribute("aria-label", `Scroll ${title} left`);
  previous.addEventListener("click", () => row.scrollBy({ left: -row.clientWidth * 0.85, behavior: "smooth" }));

  const next = document.createElement("button");
  next.className = "home-nav-btn home-nav-btn-right";
  next.type = "button";
  next.textContent = "›";
  next.setAttribute("aria-label", `Scroll ${title} right`);
  next.addEventListener("click", () => row.scrollBy({ left: row.clientWidth * 0.85, behavior: "smooth" }));

  wrapper.append(previous, row, next);
  section.append(sectionHeader, wrapper);
  resultsGrid.appendChild(section);
}

function updateSpotlight(index = 0) {
  const item = state.spotlightItems[index];
  if (!item) return;

  state.spotlightIndex = index;
  const type = getMediaType(item, "movie");
  const backdrop = $("#spotlightBackdrop");
  backdrop.classList.remove("loaded");
  backdrop.style.backgroundImage = item.backdrop_path
    ? `url("${imageUrl(item.backdrop_path, "original")}")`
    : "";
  requestAnimationFrame(() => backdrop.classList.add("loaded"));

  $("#spotlightTitle").textContent = getTitle(item);
  $("#spotlightDescription").textContent = item.overview || "A standout story from today's most-watched titles.";
  $("#spotlightMeta").innerHTML = `
    <span class="match">${Math.max(72, Math.round(Number(item.vote_average || 8) * 10))}% Match</span>
    <span>${getYear(item)}</span>
    <span>${type === "tv" ? "Series" : "Movie"}</span>
    <span class="quality-badge">HD</span>`;
  $(".eyebrow").innerHTML = `<span class="eyebrow-dot"></span> #${index + 1} in ${type === "tv" ? "TV" : "movies"} today`;
  $("#spotlightIndex").textContent = `${String(index + 1).padStart(2, "0")} / ${String(state.spotlightItems.length).padStart(2, "0")}`;

  const open = () => { window.location.href = getDetailUrl(item, type); };
  $("#spotlightPlay").onclick = open;
  $("#spotlightMore").onclick = open;
}

function startSpotlight(items, mediaType = "movie") {
  clearInterval(state.spotlightTimer);
  state.spotlightItems = items.slice(0, 5).map((item) => ({ ...item, media_type: mediaType }));
  updateSpotlight(0);

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && state.spotlightItems.length > 1) {
    state.spotlightTimer = setInterval(() => {
      updateSpotlight((state.spotlightIndex + 1) % state.spotlightItems.length);
    }, 9000);
  }
}

async function loadHomePage(mode = "trending") {
  const resultsGrid = $("#resultsGrid");
  if (!resultsGrid) return;

  setCatalogLoading(true);
  resultsGrid.innerHTML = "";
  resultsGrid.className = "";
  $("#catalogKicker").textContent = mode === "trending" ? "Curated for you" : mode === "top_rated" ? "Critics' favorites" : "Arriving soon";
  $("#catalogTitle").textContent = mode === "trending" ? "Explore Neckflix" : mode === "top_rated" ? "The highest rated" : "Coming to your screen";
  $("#resultsInfo").textContent = "Refreshing the catalog…";

  const moviePath = mode === "top_rated" ? "/movie/top_rated" : mode === "upcoming" ? "/movie/upcoming" : "/trending/movie/week";
  const tvPath = mode === "top_rated" ? "/tv/top_rated" : mode === "upcoming" ? "/tv/on_the_air" : "/trending/tv/week";
  const koreanSort = mode === "top_rated" ? "vote_average.desc&vote_count.gte=150" : "popularity.desc";

  try {
    const [movies, tvShows, korean] = await Promise.all([
      fetchJson(`${moviePath}?language=en-US&page=1`),
      fetchJson(`${tvPath}?language=en-US&page=1`),
      fetchJson(`/discover/tv?with_original_language=ko&sort_by=${koreanSort}&language=en-US&page=1`),
    ]);

    startSpotlight(movies.results || [], "movie");
    renderHomeSection(mode === "upcoming" ? "Coming soon" : "Trending movies", movies.results || [], "movie", true);
    renderHomeSection(mode === "upcoming" ? "Airing this week" : "Binge-worthy series", tvShows.results || [], "tv");
    renderHomeSection("Korean stories everyone is watching", korean.results || [], "tv");
    $("#resultsInfo").textContent = "Fresh picks, updated daily";
  } catch (error) {
    renderError(error);
  } finally {
    setCatalogLoading(false);
  }
}

async function loadFilteredCatalog(filter) {
  const config = {
    movie: {
      path: "/discover/movie?sort_by=popularity.desc&language=en-US&page=1",
      title: "Movies for every mood",
      kicker: "Big-screen energy",
      type: "movie",
    },
    tv: {
      path: "/discover/tv?sort_by=popularity.desc&language=en-US&page=1",
      title: "Series worth the commitment",
      kicker: "One more episode",
      type: "tv",
    },
    korean: {
      path: "/discover/tv?with_original_language=ko&sort_by=popularity.desc&language=en-US&page=1",
      title: "K-dramas in the spotlight",
      kicker: "From Seoul with feeling",
      type: "tv",
    },
  }[filter];

  if (!config) return loadHomePage();

  setCatalogLoading(true);
  $("#catalogKicker").textContent = config.kicker;
  $("#catalogTitle").textContent = config.title;
  $("#resultsInfo").textContent = "Loading titles…";
  $("#resultsGrid").innerHTML = "";

  try {
    const data = await fetchJson(config.path);
    const items = (data.results || []).map((item) => ({ ...item, media_type: config.type }));
    renderResults(items, config.title, false);
    if (items.length) startSpotlight(items, config.type);
  } catch (error) {
    renderError(error);
  } finally {
    setCatalogLoading(false);
  }
}

function renderResults(items, label, isSearch = true) {
  const resultsGrid = $("#resultsGrid");
  resultsGrid.innerHTML = "";
  resultsGrid.className = "results-grid";

  if (!items.length) {
    resultsGrid.className = "";
    resultsGrid.innerHTML = `<div class="empty-state"><div><strong>No titles found.</strong><span>Try a different title or browse the trending collection.</span></div></div>`;
    $("#resultsInfo").textContent = "No matches";
    return;
  }

  items.forEach((item) => resultsGrid.appendChild(buildCard(item, getMediaType(item), null, { episodeAction: getMediaType(item) === "tv" })));
  $("#resultsInfo").textContent = isSearch ? `${items.length} matches for “${label}”` : `${items.length} handpicked titles`;
}

async function searchTmdb(query) {
  const data = await fetchJson(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`);
  return (data.results || []).filter((item) => item.media_type === "movie" || item.media_type === "tv");
}

async function handleSearch(query) {
  if (!query.trim()) return;
  setCatalogLoading(true);
  $("#catalogKicker").textContent = "Search results";
  $("#catalogTitle").textContent = `Results for “${query.trim()}”`;
  $("#resultsInfo").textContent = "Searching…";
  $("#resultsGrid").innerHTML = "";

  try {
    const results = await searchTmdb(query.trim());
    renderResults(results, query.trim());
    $(".catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    renderError(error);
  } finally {
    setCatalogLoading(false);
  }
}

async function loadTvUiForShow(item) {
  const panel = $("#tvControlsSection");
  const seasonSelect = $("#seasonSelect");
  const episodesGrid = $("#episodesGrid");
  if (!panel || !seasonSelect || !episodesGrid) return;

  state.currentTvShow = item;
  panel.classList.remove("hidden");
  $("#tvTitle").textContent = getTitle(item);
  $("#tvMeta").textContent = "Loading seasons and episodes…";
  seasonSelect.innerHTML = "";
  episodesGrid.innerHTML = "";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const details = await fetchJson(`/tv/${item.id}?language=en-US`);
    const seasons = (details.seasons || []).filter((season) => season.season_number > 0 && season.episode_count > 0);

    if (!seasons.length) {
      $("#tvMeta").textContent = "Episode information is not available yet.";
      return;
    }

    $("#tvMeta").textContent = `${seasons.length} season${seasons.length === 1 ? "" : "s"} • ${details.status || "Series"}`;
    seasons.forEach((season) => {
      const option = document.createElement("option");
      option.value = season.season_number;
      option.textContent = `${season.name} · ${season.episode_count} episodes`;
      seasonSelect.appendChild(option);
    });

    await loadEpisodesForSeason(item.id, seasons[0].season_number, episodesGrid, false);
  } catch (error) {
    $("#tvMeta").textContent = "Episode information could not be loaded.";
    showToast("Could not load episodes. Please try again.");
    console.error(error);
  }
}

async function loadEpisodesForSeason(tvId, seasonNumber, target, detailMode) {
  target.innerHTML = "";
  const data = await fetchJson(`/tv/${tvId}/season/${seasonNumber}?language=en-US`);

  (data.episodes || []).forEach((episode) => {
    if (detailMode) {
      target.appendChild(buildDetailEpisode(tvId, seasonNumber, episode));
      return;
    }

    const button = document.createElement("button");
    button.className = "episode-btn";
    button.type = "button";
    button.innerHTML = `<span>Episode ${episode.episode_number}</span><strong></strong>`;
    $("strong", button).textContent = episode.name || `Episode ${episode.episode_number}`;
    button.addEventListener("click", () => {
      window.location.href = `detail.html?type=tv&id=${encodeURIComponent(tvId)}&season=${encodeURIComponent(seasonNumber)}&episode=${encodeURIComponent(episode.episode_number)}`;
    });
    target.appendChild(button);
  });
}

function setupHomeInteractions() {
  createSkeletons();

  $("#searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSearch($("#searchInput").value);
  });

  $("#mobileSearchToggle")?.addEventListener("click", () => {
    $("#searchInput")?.focus();
    $(".search-stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $$(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-link").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const filter = button.dataset.filter;
      if (filter === "home") loadHomePage();
      else loadFilteredCatalog(filter);
      $(".catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $$(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".filter-chip").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      loadHomePage(button.dataset.quickFilter);
    });
  });

  $("#seasonSelect")?.addEventListener("change", (event) => {
    if (state.currentTvShow) {
      loadEpisodesForSeason(state.currentTvShow.id, event.target.value, $("#episodesGrid"), false).catch((error) => {
        showToast("Could not load that season.");
        console.error(error);
      });
    }
  });

  $("#closeEpisodesBtn")?.addEventListener("click", () => $("#tvControlsSection")?.classList.add("hidden"));
  loadHomePage();
}

function buildPlayerUrl(type, id, season = 1, episode = 1) {
  const params = new URLSearchParams({
    overlay: "true",
    color: "E50914",
    progress: "0",
    controls: "true",
  });

  if (type === "movie") {
    return `${PLAYER_BASE_URL}/movie/${id}?${params.toString()}`;
  }

  params.set("nextEpisode", "true");
  params.set("episodeSelector", "true");
  params.set("autoplayNextEpisode", "true");
  return `${PLAYER_BASE_URL}/tv/${id}/${season}/${episode}?${params.toString()}`;
}

function getDetailParams() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type") === "tv" ? "tv" : "movie";
  return {
    type,
    id: params.get("id"),
    season: Number(params.get("season") || 1),
    episode: Number(params.get("episode") || 1),
  };
}

function displayFacts(details, type) {
  const runtime = type === "movie"
    ? details.runtime
    : details.episode_run_time?.[0];
  const languageNames = typeof Intl?.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;
  let language = details.original_language?.toUpperCase() || "—";

  try {
    language = languageNames?.of(details.original_language) || language;
  } catch {
    // Keep the language code when a browser cannot resolve it.
  }

  const facts = [
    ["Release", getYear(details)],
    [type === "movie" ? "Runtime" : "Episode length", runtime ? `${runtime} min` : "—"],
    ["Status", details.status || "—"],
    ["Language", language],
  ];

  $("#factsGrid").innerHTML = facts
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function buildDetailEpisode(tvId, seasonNumber, episode) {
  const button = document.createElement("button");
  const params = getDetailParams();
  button.type = "button";
  button.className = "detail-episode-card";
  if (params.season === Number(seasonNumber) && params.episode === Number(episode.episode_number)) {
    button.classList.add("active");
  }

  const still = episode.still_path
    ? `<div class="episode-still"><img src="${imageUrl(episode.still_path, "w300")}" alt="" loading="lazy" /></div>`
    : `<div class="episode-still"></div>`;

  button.innerHTML = `
    <span class="episode-number">${String(episode.episode_number).padStart(2, "0")}</span>
    ${still}
    <span class="episode-copy"><strong></strong><p></p></span>
    <span class="episode-duration">${episode.runtime ? `${episode.runtime} min` : ""}</span>`;
  $("strong", button).textContent = episode.name || `Episode ${episode.episode_number}`;
  $("p", button).textContent = episode.overview || "Episode details are coming soon.";

  button.addEventListener("click", () => {
    const playerFrame = $("#playerFrame");
    playerFrame.src = buildPlayerUrl("tv", tvId, seasonNumber, episode.episode_number);
    $("#watchTitle").textContent = `Season ${seasonNumber} · Episode ${episode.episode_number}`;
    $("#watchSection").classList.remove("hidden");
    $$(".detail-episode-card").forEach((card) => card.classList.remove("active"));
    button.classList.add("active");
    $("#watchSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  return button;
}

async function setupDetailEpisodes(details, params) {
  const section = $("#detailEpisodes");
  const selector = $("#detailSeasonSelect");
  const list = $("#detailEpisodeList");
  const seasons = (details.seasons || []).filter((season) => season.season_number > 0 && season.episode_count > 0);

  if (!seasons.length) return;
  section.classList.remove("hidden");
  selector.innerHTML = "";

  seasons.forEach((season) => {
    const option = document.createElement("option");
    option.value = season.season_number;
    option.textContent = season.name;
    option.selected = season.season_number === params.season;
    selector.appendChild(option);
  });

  const selectedSeason = seasons.some((season) => season.season_number === params.season)
    ? params.season
    : seasons[0].season_number;
  selector.value = selectedSeason;
  await loadEpisodesForSeason(params.id, selectedSeason, list, true);

  selector.addEventListener("change", () => {
    loadEpisodesForSeason(params.id, selector.value, list, true).catch((error) => {
      showToast("Could not load that season.");
      console.error(error);
    });
  });
}

function renderRecommendations(items, type) {
  const row = $("#recommendationsRow");
  row.innerHTML = "";
  items.slice(0, 16).forEach((item) => {
    item.media_type = type;
    row.appendChild(buildCard(item, type));
  });

  if (!items.length) {
    $(".recommendations")?.classList.add("hidden");
  }
}

async function loadDetailPage() {
  const params = getDetailParams();
  if (!params.id) {
    window.location.replace("index.html");
    return;
  }

  try {
    const [details, credits, recommendations] = await Promise.all([
      fetchJson(`/${params.type}/${params.id}?language=en-US`),
      fetchJson(`/${params.type}/${params.id}/credits?language=en-US`),
      fetchJson(`/${params.type}/${params.id}/recommendations?language=en-US&page=1`),
    ]);

    const title = getTitle(details);
    const typeLabel = params.type === "movie" ? "Movie" : "Series";
    document.title = `${title} — Neckflix`;
    $("#detailBackdrop").style.backgroundImage = details.backdrop_path
      ? `url("${imageUrl(details.backdrop_path, "original")}")`
      : "";
    $("#titleText").textContent = title;
    $("#overviewText").textContent = details.overview || "No synopsis is available for this title yet.";

    const genres = (details.genres || []).slice(0, 3).map((genre) => genre.name);
    $("#metaText").innerHTML = [getYear(details), ...genres].map((value) => `<span>${value}</span>`).join("<span>•</span>");
    $("#ratingText").textContent = `★ ${Number(details.vote_average || 0).toFixed(1)} / 10 · ${Number(details.vote_count || 0).toLocaleString()} ratings`;

    const cast = (credits.cast || []).slice(0, 6).map((person) => person.name);
    $("#castText").textContent = cast.length ? `Starring ${cast.join(", ")}` : "Cast information is coming soon.";
    $("#detailBadges").innerHTML = `<span class="pill ${params.type === "tv" ? "pill-tv" : "pill-movie"}">${typeLabel}</span><span class="pill">${details.adult ? "18+" : "Audience"}</span>`;
    displayFacts(details, params.type);
    renderRecommendations(recommendations.results || [], params.type);

    let activePlayerUrl = buildPlayerUrl(params.type, params.id, params.season, params.episode);
    const openPlayer = () => {
      $("#playerFrame").src = activePlayerUrl;
      $("#watchTitle").textContent = params.type === "tv"
        ? `${title} · S${params.season} E${params.episode}`
        : title;
      $("#watchSection").classList.remove("hidden");
      $("#watchSection").scrollIntoView({ behavior: "smooth", block: "start" });
    };

    $("#playBtn").addEventListener("click", openPlayer);
    $("#closePlayerBtn").addEventListener("click", () => {
      $("#playerFrame").src = "";
      $("#watchSection").classList.add("hidden");
      $("#detailHero").scrollIntoView({ behavior: "smooth" });
    });

    if (params.type === "tv") {
      $("#trailerBtn").textContent = "＋ Show episodes";
      $("#trailerBtn").addEventListener("click", () => $("#detailEpisodes").scrollIntoView({ behavior: "smooth", block: "start" }));
      await setupDetailEpisodes(details, params);
    } else {
      $("#trailerBtn").textContent = "＋ More like this";
      $("#trailerBtn").addEventListener("click", () => $(".recommendations").scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  } catch (error) {
    console.error(error);
    $("#titleText").textContent = "This title could not be loaded.";
    $("#overviewText").textContent = "Check your connection or return to browse and choose another title.";
    $("#playBtn").classList.add("hidden");
    $("#trailerBtn").classList.add("hidden");
    showToast("Could not load title details.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setHeaderBehavior();
  if (document.body.dataset.page === "detail") {
    loadDetailPage();
  } else {
    setupHomeInteractions();
  }
});
