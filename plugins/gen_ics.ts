import ical from "npm:ical-generator@8";
import rrule from "npm:rrule@2.8.1";
import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";

const { RRule } = rrule;

const DOMINIO = "calendario.riomakerspace.com.br";
const TZ = "America/Sao_Paulo";

interface EventoFrontmatter {
  title: string;
  inicio: string;
  fim: string;
  local: string;
  link_call?: string;
  descricao: string;
  rrule?: string;
  exdates?: string[];
  excecoes?: Array<{
    data: string;
    titulo: string;
    descricao?: string;
  }>;
}

interface Ocorrencia {
  iso: string;
  inicio_utc: string;       // YYYYMMDDTHHMMSSZ (Google)
  fim_utc: string;          // YYYYMMDDTHHMMSSZ (Google)
  inicio_utc_iso: string;   // ISO 8601 com Z (Outlook)
  fim_utc_iso: string;      // ISO 8601 com Z (Outlook)
  data_fmt: string;         // "sáb, 01 ago 2026 — 14h00"
  titulo?: string;          // se for exceção temática
}

function paraUtc(dtLocal: string): Date {
  return new Date(dtLocal);
}

function fmtGoogle(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function fmtIso(d: Date): string {
  return d.toISOString().replace(/\.000Z$/, "Z");
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function fmtHumano(d: Date): string {
  // Sempre formata em America/Sao_Paulo (BRT), independente do fuso da máquina
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday").replace(".", "");
  const day = get("day");
  const month = get("month").replace(".", "").slice(0, 3);
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  return `${weekday}, ${day} ${month} ${year} — ${hour}h${minute}`;
}

function buildOcorrencia(inicio: Date, fim: Date, titulo?: string): Ocorrencia {
  return {
    iso: inicio.toISOString(),
    inicio_utc: fmtGoogle(inicio),
    fim_utc: fmtGoogle(fim),
    inicio_utc_iso: fmtIso(inicio),
    fim_utc_iso: fmtIso(fim),
    data_fmt: fmtHumano(inicio),
    titulo,
  };
}

function expandirOcorrencias(ev: EventoFrontmatter, limite = 4): Ocorrencia[] {
  const inicio = paraUtc(ev.inicio);
  const fim = paraUtc(ev.fim);
  const duracaoMs = fim.getTime() - inicio.getTime();

  if (!ev.rrule) {
    return [buildOcorrencia(inicio, fim)];
  }

  const opts = RRule.parseString(ev.rrule);
  opts.dtstart = inicio;
  const rule = new RRule(opts);
  const agora = new Date();
  const ate = new Date(agora.getTime() + 365 * 24 * 60 * 60 * 1000);
  const todas = rule.between(agora, ate, true);

  const exdatesSet = new Set((ev.exdates || []).map((d) => paraUtc(d).getTime()));

  const excecoesMap = new Map<number, { titulo: string; descricao?: string }>();
  for (const exc of ev.excecoes || []) {
    excecoesMap.set(paraUtc(exc.data).getTime(), { titulo: exc.titulo, descricao: exc.descricao });
  }

  const ocorrencias: Ocorrencia[] = [];
  for (const occ of todas) {
    if (exdatesSet.has(occ.getTime())) continue;
    const exc = excecoesMap.get(occ.getTime());
    const occFim = new Date(occ.getTime() + duracaoMs);
    ocorrencias.push(buildOcorrencia(occ, occFim, exc?.titulo));
    if (ocorrencias.length >= limite) break;
  }
  return ocorrencias;
}

function gerarIcs(ev: EventoFrontmatter, slug: string): string {
  const inicio = paraUtc(ev.inicio);
  const fim = paraUtc(ev.fim);

  const cal = ical({
    name: ev.title,
    prodId: {
      company: "Rio Makerspace",
      product: "Calendário",
      language: "PT",
    },
  });

  const uid = `${slug}@${DOMINIO}`;

  const eventoPrincipal = cal.createEvent({
    id: uid,
    start: inicio,
    end: fim,
    summary: ev.title,
    description: ev.descricao,
    location: ev.local,
    url: ev.link_call,
    stamp: new Date(),
  });

  if (ev.rrule) {
    if (ev.exdates && ev.exdates.length > 0) {
      // Com exdates: usa RRuleSet (implementa ICalRRuleStub)
      const rruleStr = `DTSTART:${fmtGoogle(inicio)}\nRRULE:${ev.rrule}`;
      const set = rrule.rrulestr(rruleStr, { forceset: true });
      for (const ex of ev.exdates) {
        set.exdate(paraUtc(ex));
      }
      eventoPrincipal.repeating(set as never);
    } else {
      eventoPrincipal.repeating(ev.rrule);
    }
  }

  for (const exc of ev.excecoes || []) {
    const excInicio = paraUtc(exc.data);
    const excFim = new Date(excInicio.getTime() + (fim.getTime() - inicio.getTime()));
    cal.createEvent({
      id: uid,
      start: excInicio,
      end: excFim,
      summary: exc.titulo,
      description: exc.descricao || ev.descricao,
      location: ev.local,
      url: ev.link_call,
      stamp: new Date(),
      recurrenceId: excInicio,
    });
  }

  return cal.toString();
}

export default function (site: any) {
  site.preprocess([".md"], (pages: any[]) => {
    for (const page of pages) {
      const data = page.data;
      if (data.layout !== "evento.njk") continue;

      const ev: EventoFrontmatter = {
        title: data.title,
        inicio: data.inicio,
        fim: data.fim,
        local: data.local,
        link_call: data.link_call,
        descricao: data.descricao,
        rrule: data.rrule,
        exdates: data.exdates,
        excecoes: data.excecoes,
      };

      const ocorrencias = expandirOcorrencias(ev);
      data.proximas_ocorrencias = ocorrencias;
      data.slug = page.data.url
        ? String(page.data.url).replace(/\/$/, "").split("/").pop() || "evento"
        : "evento";
    }
  });

  site.addEventListener("afterBuild", async () => {
    const { walk } = await import("https://deno.land/std@0.224.0/fs/walk.ts");
    const { resolve, join } = await import("https://deno.land/std@0.224.0/path/mod.ts");

    const contentDir = resolve(site.src(), "eventos");
    const outDir = resolve(site.dest(), "cal");

    try {
      await Deno.mkdir(outDir, { recursive: true });
    } catch (_e) {
      // já existe
    }

    for await (const entry of walk(contentDir, { exts: [".md"] })) {
      if (entry.name.startsWith("_")) continue;

      const raw = await Deno.readTextFile(entry.path);
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = parseYaml(fmMatch[1]) as EventoFrontmatter;
      if (!fm.rrule && !fm.inicio) continue;

      const slug = entry.name.replace(/\.md$/, "");
      const ics = gerarIcs(fm, slug);
      const outPath = join(outDir, `${slug}.ics`);
      await Deno.writeTextFile(outPath, ics);
      console.log(`  gerado: cal/${slug}.ics`);
    }
  });
}