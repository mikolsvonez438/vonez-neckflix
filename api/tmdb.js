const TMDB_API_BASE = "https://api.themoviedb.org/3";

const allowedPaths = [
  /^\/search\/multi$/,
  /^\/discover\/(movie|tv)$/,
  /^\/trending\/(movie|tv)\/(day|week)$/,
  /^\/movie\/(popular|top_rated|upcoming)$/,
  /^\/tv\/(popular|top_rated|on_the_air)$/,
  /^\/(movie|tv)\/\d+$/,
  /^\/(movie|tv)\/\d+\/(credits|recommendations)$/,
  /^\/tv\/\d+\/season\/\d+$/,
];

const allowedQueryKeys = new Set([
  "include_adult",
  "language",
  "page",
  "query",
  "sort_by",
  "vote_count.gte",
  "with_original_language",
]);

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.TMDB_ACCESS_TOKEN;
  if (!token) {
    return response.status(500).json({
      error: "The catalog service is not configured. Add TMDB_ACCESS_TOKEN to the Vercel environment.",
    });
  }

  const rawPath = Array.isArray(request.query.path)
    ? request.query.path[0]
    : request.query.path;

  if (
    !rawPath ||
    typeof rawPath !== "string" ||
    rawPath.length > 600 ||
    !rawPath.startsWith("/") ||
    rawPath.startsWith("//")
  ) {
    return response.status(400).json({ error: "Invalid catalog request" });
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(`${TMDB_API_BASE}${rawPath}`);
  } catch {
    return response.status(400).json({ error: "Invalid catalog request" });
  }

  const originAllowed = upstreamUrl.origin === new URL(TMDB_API_BASE).origin;
  const apiPath = upstreamUrl.pathname.slice(2);
  const pathAllowed = allowedPaths.some((pattern) => pattern.test(apiPath));
  const queryAllowed = [...upstreamUrl.searchParams.keys()].every((key) => allowedQueryKeys.has(key));
  const searchQuery = upstreamUrl.searchParams.get("query") || "";

  if (!originAllowed || !pathAllowed || !queryAllowed || searchQuery.length > 120) {
    return response.status(403).json({ error: "Catalog request is not allowed" });
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await upstreamResponse.json().catch(() => ({
      status_message: "The movie service returned an invalid response.",
    }));

    if (!upstreamResponse.ok) {
      return response.status(upstreamResponse.status).json({
        error: data.status_message || "The movie service could not complete the request.",
      });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    return response.status(200).json(data);
  } catch (error) {
    console.error("TMDB proxy error", error);
    return response.status(502).json({ error: "The movie service is temporarily unavailable." });
  }
};
