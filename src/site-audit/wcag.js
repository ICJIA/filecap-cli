// Map an axe-core rule's tags to a WCAG conformance level. axe tags each rule
// with its WCAG mapping, e.g. ["cat.color","wcag2aa","wcag143"]. We bucket by
// the most basic level present (A before AA before AAA) — the binding
// conformance level — and fall back to "best-practice" for axe rules that carry
// no WCAG success-criterion tag.

const A_TAGS = new Set(["wcag2a", "wcag21a", "wcag22a"]);
const AA_TAGS = new Set(["wcag2aa", "wcag21aa", "wcag22aa"]);
const AAA_TAGS = new Set(["wcag2aaa", "wcag21aaa", "wcag22aaa"]);

export function wcagLevelForTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  if (list.some((t) => A_TAGS.has(t))) return "A";
  if (list.some((t) => AA_TAGS.has(t))) return "AA";
  if (list.some((t) => AAA_TAGS.has(t))) return "AAA";
  return "best-practice";
}
