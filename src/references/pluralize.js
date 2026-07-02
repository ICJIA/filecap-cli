// v1.39.0 (B4) — shared singular⇄plural candidate rules for content-type
// discovery. Both Strapi adapters pair a singular query field with its
// plural by generating candidates and checking set membership against the
// schema's actual field names — a candidate that doesn't exist in the
// schema is never used, so extra rules cannot create wrong pairs, only
// recover pairs the old ies/es/s rules silently dropped (quiz/quizzes,
// analysis/analyses → their entries vanished from the sidecar).
//
// The irregular map matches EXACT names only (Strapi query fields are
// camelCase; a suffix-composed irregular like keyPeople is not attempted —
// it would land in the adapter's could-not-pair WARN instead).

const IRREGULAR_PLURALS = new Map([
  ["person", "people"],
  ["quiz", "quizzes"],
  ["analysis", "analyses"],
  ["criterion", "criteria"],
  ["index", "indices"],
  ["matrix", "matrices"],
  ["syllabus", "syllabi"],
  ["curriculum", "curricula"],
]);

const IRREGULAR_SINGULARS = new Map(
  [...IRREGULAR_PLURALS].map(([s, p]) => [p, s]),
);

// Forward: singular → plural candidates, most specific first. Used by the
// v4 adapter (v4 schemas list singular+plural pairs directly).
export function pluralCandidatesFor(singular) {
  const out = [];
  const irregular = IRREGULAR_PLURALS.get(singular);
  if (irregular) out.push(irregular);
  if (singular.endsWith("y")) out.push(singular.slice(0, -1) + "ies");
  if (singular.endsWith("is")) out.push(singular.slice(0, -2) + "es"); // analysis → analyses
  if (singular.endsWith("z")) out.push(singular + "zes"); // quiz → quizzes
  if (singular.endsWith("us")) out.push(singular.slice(0, -2) + "i"); // syllabus → syllabi
  if (/[sxz]$/.test(singular)) out.push(singular + "es");
  out.push(singular + "s");
  return out;
}

// Reverse: plural → singular candidates, most specific first. Used by the
// v3 adapter (v3 derives the plural from *Connection paginator names and
// must find the matching singular).
export function singularCandidatesFor(plural) {
  const out = [];
  const irregular = IRREGULAR_SINGULARS.get(plural);
  if (irregular) out.push(irregular);
  if (plural.endsWith("ies")) out.push(plural.slice(0, -3) + "y");
  if (plural.endsWith("zes")) out.push(plural.slice(0, -3)); // quizzes → quiz
  if (plural.endsWith("es")) {
    out.push(plural.slice(0, -2));
    out.push(plural.slice(0, -2) + "is"); // analyses → analysis
  }
  if (plural.endsWith("i")) out.push(plural.slice(0, -1) + "us"); // syllabi → syllabus
  if (plural.endsWith("s")) out.push(plural.slice(0, -1));
  return out;
}
