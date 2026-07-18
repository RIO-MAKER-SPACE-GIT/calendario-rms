import ical, { ICalEventStatus } from "npm:ical-generator@8";
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

interface ExcecaoFutura {
  iso: string;
  data_fmt: string;
  titulo: string;
  descricao?: string;
}

interface ExdateFuturo {
  iso: string;
  data_fmt: string;
}

interface Ocorrencia {
  iso: string;
  fim_iso: string;
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
    fim_iso: fim.toISOString(),
    inicio_utc: fmtGoogle(inicio),
    fim_utc: fmtGoogle(fim),
    inicio_utc_iso: fmtIso(inicio),
    fim_utc_iso: fmtIso(fim),
    data_fmt: fmtHumano(inicio),
    titulo,
  };
}

function expandirOcorrencias(ev: EventoFrontmatter, limite = 12): Ocorrencia[] {
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

/**
 * Gera `.ics` "flat" (expandido): cada ocorrência vira um VEVENT individual
 * com mesmo UID + RECURRENCE-ID único. Sem RRULE, sem EXDATE.
 *
 * Workaround pra clientes que não suportam BYSETPOS ou RRULE complexa
 * (ex.: Proton Calendar). Não é assinável — user precisa re-baixar pra
 * atualizar cancelamentos/exceções.
 *
 * Retorna null quando o evento não tem rrule (one-off não precisa de flat).
 */
function gerarIcsFlat(ev: EventoFrontmatter, slug: string): string | null {
  if (!ev.rrule) return null;

  const inicio = paraUtc(ev.inicio);
  const fim = paraUtc(ev.fim);
  const duracaoMs = fim.getTime() - inicio.getTime();
  const agora = new Date();

  const cal = ical({
    name: `${ev.title} (expandido)`,
    prodId: {
      company: "Rio Makerspace",
      product: "Calendário",
      language: "PT",
    },
  });

  const uid = `${slug}@${DOMINIO}`;

  // Datas de exceções: entram como VEVENT próprio (SEQUENCE:1) no loop
  // abaixo, então não duplicamos como ocorrência normal.
  const excecoesDatas = new Set(
    (ev.excecoes || []).map((e) => paraUtc(e.data).getTime()),
  );

  // 1) Ocorrências normais (12 próximas futuras, já filtrando exdates).
  //    Exceções mescladas pelo expandirOcorrencias (titulo próprio) são
  //    puladas aqui — entram pelo loop de exceções abaixo com SEQUENCE:1.
  const ocorrencias = expandirOcorrencias(ev, 12);
  for (const occ of ocorrencias) {
    const occInicio = new Date(occ.iso);
    if (excecoesDatas.has(occInicio.getTime())) continue;
    const occFim = new Date(occ.fim_iso);
    cal.createEvent({
      id: uid,
      start: occInicio,
      end: occFim,
      summary: occ.titulo || ev.title,
      description: ev.descricao,
      location: ev.local,
      url: ev.link_call,
      stamp: new Date(),
      sequence: 0,
      recurrenceId: occInicio,
    });
  }

  // 2) Exceções (todas, passadas ou futuras): VEVENT com SEQUENCE:1 e
  //    summary/description próprios. Clientes casam por (UID, RECURRENCE-ID)
  //    e sobrescrevem a ocorrência normal correspondente.
  for (const exc of ev.excecoes || []) {
    const excInicio = paraUtc(exc.data);
    const excFim = new Date(excInicio.getTime() + duracaoMs);
    cal.createEvent({
      id: uid,
      start: excInicio,
      end: excFim,
      summary: exc.titulo,
      description: exc.descricao || ev.descricao,
      location: ev.local,
      url: ev.link_call,
      stamp: new Date(),
      sequence: 1,
      recurrenceId: excInicio,
    });
  }

  // 3) Exdates futuros: VEVENT com STATUS:CANCELLED. Sinaliza remoção ao
  //    cliente na re-import. Passados não incluímos (não estão no calendário
  //    do user).
  for (const exd of ev.exdates || []) {
    const exdInicio = paraUtc(exd);
    if (exdInicio.getTime() < agora.getTime()) continue;
    const exdFim = new Date(exdInicio.getTime() + duracaoMs);
    cal.createEvent({
      id: uid,
      start: exdInicio,
      end: exdFim,
      summary: `Cancelada: ${ev.title}`,
      description: "Ocorrência cancelada.",
      location: ev.local,
      url: ev.link_call,
      stamp: new Date(),
      sequence: 1,
      status: ICalEventStatus.CANCELLED,
      recurrenceId: exdInicio,
    });
  }

  return cal.toString();
}

export default function (site: any) {
  site.preprocess([".md"], (pages: any[]) => {
    const agora = new Date();
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

      // Próxima ocorrência real (1ª futura). Usada no hero "Próximo evento".
      data.proxima_ocorrencia = ocorrencias.find((o) =>
        new Date(o.fim_iso || o.iso).getTime() >= agora.getTime()
      ) || ocorrencias[0];

      // Exceções futuras: {iso, data_fmt, titulo, descricao?}
      data.excecoes_futuras = (ev.excecoes || [])
        .filter((exc) => paraUtc(exc.data).getTime() >= agora.getTime())
        .map((exc) => {
          const d = paraUtc(exc.data);
          return {
            iso: d.toISOString(),
            data_fmt: fmtHumano(d),
            titulo: exc.titulo,
            descricao: exc.descricao,
          } as ExcecaoFutura;
        });

      // Exdates futuros: {iso, data_fmt}
      data.exdates_futuros = (ev.exdates || [])
        .filter((d) => paraUtc(d).getTime() >= agora.getTime())
        .map((d) => {
          const dt = paraUtc(d);
          return {
            iso: dt.toISOString(),
            data_fmt: fmtHumano(dt),
          } as ExdateFuturo;
        });

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

      const flat = gerarIcsFlat(fm, slug);
      if (flat) {
        const flatPath = join(outDir, `${slug}-flat.ics`);
        await Deno.writeTextFile(flatPath, flat);
        console.log(`  gerado: cal/${slug}-flat.ics`);
      }
    }
  });
}