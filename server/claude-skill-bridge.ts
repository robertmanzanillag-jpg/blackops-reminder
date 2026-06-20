import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface ClaudeSkill {
  name: string;
  description: string;
  body: string;
  path: string;
}

const SKILLS_DIR = path.join(process.cwd(), ".claude", "skills");
const MAX_SKILLS = 4;
const MAX_BODY_CHARS = 3200;
const MAX_CONTEXT_CHARS = 14000;

const MARKETING_TERMS = [
  "ad", "ads", "anuncio", "anuncios", "campaign", "campana", "campanas", "cac", "roas", "cpl", "ctr",
  "creative", "creatives", "creativo", "creativos", "hooks", "offer", "oferta", "landing", "funnel",
  "meta", "google ads", "youtube", "tiktok", "linkedin", "budget", "presupuesto", "metricool", "postear",
  "publicar", "programar", "caption", "copy", "marketing",
];

const DESIGN_TERMS = [
  "design", "diseno", "diseño", "ui", "ux", "pantalla", "layout", "brand", "branding", "visual",
  "flyer", "canva", "logo", "landing page", "creative", "creativo", "assets", "mockup", "prototype",
  "prototipo", "component", "frontend", "clips", "video", "videos",
];

function normalizeText(value = ""): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: raw.trim() };
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (parts) metadata[parts[1]] = parts[2].replace(/^["']|["']$/g, "").trim();
  }
  return { metadata, body: raw.slice(match[0].length).trim() };
}

function scoreSkill(skill: ClaudeSkill, message: string): number {
  const haystack = normalizeText(`${skill.name} ${skill.description} ${skill.body.slice(0, 1200)}`);
  const normalizedMessage = normalizeText(message);
  const messageTerms = normalizedMessage.split(/\s+/).filter((term) => term.length > 2);
  let score = 0;

  for (const term of messageTerms) {
    if (haystack.includes(term)) score += 1;
  }
  for (const term of MARKETING_TERMS) {
    if (normalizedMessage.includes(term) && haystack.includes(term)) score += 4;
  }
  for (const term of DESIGN_TERMS) {
    if (normalizedMessage.includes(term) && haystack.includes(term)) score += 4;
  }
  if (/marketing|ads|creative|campaign|metricool/.test(haystack) && MARKETING_TERMS.some((term) => normalizedMessage.includes(term))) score += 8;
  if (/design|diseno|diseño|ui|ux|visual|brand|canva/.test(haystack) && DESIGN_TERMS.some((term) => normalizedMessage.includes(term))) score += 8;
  return score;
}

async function readClaudeSkills(): Promise<ClaudeSkill[]> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
  const skills: ClaudeSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    const raw = await readFile(skillPath, "utf8").catch(() => null);
    if (!raw) continue;
    const { metadata, body } = extractFrontmatter(raw);
    skills.push({
      name: metadata.name || entry.name,
      description: metadata.description || "",
      body,
      path: path.relative(process.cwd(), skillPath).replace(/\\/g, "/"),
    });
  }

  return skills;
}

export async function buildClaudeSkillContext(message?: string): Promise<string> {
  const skills = await readClaudeSkills();
  if (skills.length === 0) return "";

  const scored = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, message || "") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SKILLS)
    .map((item) => item.skill);

  if (scored.length === 0) {
    return [
      "## Claude Skills",
      "BlackOps can read local `.claude/skills/*/SKILL.md` files. No specific skill matched this message; keep normal app rules.",
      `Available skills: ${skills.map((skill) => skill.name).join(", ")}`,
    ].join("\n");
  }

  const blocks = scored.map((skill) => [
    `### ${skill.name}`,
    `Source: ${skill.path}`,
    skill.description ? `Description: ${skill.description}` : "",
    "",
    skill.body.slice(0, MAX_BODY_CHARS),
  ].filter(Boolean).join("\n"));

  return [
    "## Claude Skills Active For This Message",
    "Use these local Claude skill instructions as operating guidance for this chat response. They do not grant new tools by themselves; use the app's existing routes, approvals, and integrations. If a skill asks for slash commands, translate the intent into natural BlackOps behavior.",
    ...blocks,
  ].join("\n\n").slice(0, MAX_CONTEXT_CHARS);
}

export async function listClaudeSkillNames(): Promise<string[]> {
  return (await readClaudeSkills()).map((skill) => skill.name);
}
