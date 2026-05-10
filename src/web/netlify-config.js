export function generateNetlifyToml() {
  return `[build]
  publish = "."
  command = ""

[[headers]]
  for = "/*.csv"
  [headers.values]
    Cache-Control = "public, max-age=3600"
    Content-Disposition = "attachment"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "public, max-age=300"
    X-Robots-Tag = "noindex, nofollow"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "no-referrer"
`;
}
