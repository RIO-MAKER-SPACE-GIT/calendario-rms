# AGENTS.md — Calendário Rio Makerspace

Site estático de calendário do Rio Makerspace. Calls recorrentes 1º e 3º sábado de cada mês, 14h-15h BRT. Geração de `.ics` assinável via `webcal://` para substituir convites Google.

## Stack

- **SSG:** [Lume](https://lume.land) (Deno, TypeScript)
- **Template:** Nunjucks (via plugin Lume; sintaxe Liquid-like)
- **Estilo:** CSS cru, sem Tailwind
- **iCalendar:** lib `npm:ical-generator` + `npm:rrule` (acessíveis via Deno)
- **Analytics:** Vince (placeholder, ativar depois)
- **Deploy:** Cloudflare Pages
- **Domínio:** `calendario.riomakerspace.com.br`

## Princípios

- **Pouco JavaScript client-side.** Site é SSG (HTML+CSS), mas há um snippet vanilla inline no `base.njk` que executa em runtime pra: destacar a próxima ocorrência real (não a do build), esconder ocorrências passadas, e exibir badge "AO VIVO" quando uma ocorrência está rolando agora. Sem framework, sem fetch, sem onclick nos botões de calendário (esses continuam `<a href>` puro).
- **Build expande, runtime reordena.** O hook `gen_ics.ts` gera `proximas_ocorrencias` com 12 itens no build, e os templates embarcam cada data como `data-attribute` (`data-inicio`, `data-fim`) nos elementos e um `<script type="application/json">` com o array completo. O JS só esconde passadas, recalcula a próxima ocorrência real e exibe badge "AO VIVO". Sem biblioteca de `rrule` client-side.
- **Página do evento tem 3 seções** (não uma lista de 12 datas iguais): (1) **Próximo evento** — hero card com a 1ª ocorrência futura (com tema se for `excecao`), badges "Próxima" e "AO VIVO"; (2) **Eventos especiais** — `excecoes` futuras; (3) **Eventos cancelados** — `exdates` futuros. Eventos one-off (sem `rrule`) mostram só a seção 1.
- **`.ics` é gerado em build time** por hook `afterBuild`, não em runtime.
- **1 arquivo = 1 série recorrente.** Não criar 1 `.md` por ocorrência. Usar `rrule` + `exdates` + `excecoes`.
- **Preservar motivação SSG.** Não introduzir SaaS (Luma, Google Calendar embed) nem backend dinâmico. MVP sem RSVP serverless; backend Cloudflare Worker é fase 2 se necessário.

## Schema do evento (YAML frontmatter)

```yaml
---
title: Call do Makerspace
inicio: 2026-08-01T14:00:00-03:00      # 1º sábado, horário real BRT
fim: 2026-08-01T15:00:00-03:00
local: Jitsi
link_call: https://meet.jit.si/riomakerspace   # link da call → botão "Entrar" (NÃO usar `url`, Lume reserva esse campo)
descricao: Calls mensais abertas do Rio Makerspace.
rrule: FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3   # 1º e 3º sábado, infinito
exdates:
  - 2026-09-06T14:00:00-03:00           # ocorrência cancelada → vira EXDATE
excecoes:
  - data: 2026-08-15T14:00:00-03:00     # 3º sábado de ago com tema
    titulo: Call especial: Impressão 3D
    descricao: João apresenta workflow de resin printing.
---
Corpo markdown: descrição longa, instruções, etc.
```

Regras do schema:
- `inicio`/`fim` sempre com offset `-03:00` (BRT). O hook converte pra UTC ao gerar `.ics`.
- **`inicio` deve ser a primeira ocorrência real da série**, numa data quecase no padrão da `rrule` (ex.: pra `BYDAY=SA;BYSETPOS=1,3`, tem que cair num 1º ou 3º sábado). Pode ser no passado (série já rolava) ou futuro (série nova). Se setar `inicio` no futuro, ocorrências entre hoje e essa data **não aparecem** — a lib `rrule` trata `DTSTART` como começo literal da série.
- `link_call` (não `url`) é o link da call — `url` é reservado pelo Lume pra URL da página.
- `rrule` é string RFC 5545 crua, passada direto pro `ical-generator`.
- `exdates[]` = ocorrências canceladas → viram `EXDATE` no `.ics` e somem da lista HTML.
- `excecoes[]` = ocorrência modificada (tema/presentador) → vira `VEVENT` extra com `RECURRENCE-ID` no `.ics`, e na lista HTML mostra o `titulo` da exceção em vez do default.

## Cards de calendário (por evento)

Na página do evento (`evento.njk`), o botão **Entrar na call** (se `link_call` existir) aparece largo acima do grid — é ação primária (participar), não de calendário.

Abaixo, grid responsivo (1 col mobile / 2 tablet / 3 desktop) com 5 cards:

1. **Google Calendar** — `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=<inicioUTC>/<fimUTC>&location=...&details=...` (URL-encoded). CTA: "Abrir no Google".
2. **Outlook** — `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&start=...&end=...&subject=...&body=...&location=...`. CTA: "Abrir no Outlook".
3. **Baixar `.ics`** — `<a href="/cal/<slug>.ics" download>`. Importação one-shot, 1ª ocorrência. CTA: "Baixar".
4. **Assinar (auto-update)** — `<a href="webcal://calendario.riomakerspace.com.br/cal/<slug>.ics">`. Assinatura: cliente refetcha e pega updates de `EXDATE`/`excecoes`. CTA: "Assinar".
5. **`.ics` expandido** — `<a href="/cal/<slug>-flat.ics" download>`. Workaround pra clientes que não suportam `BYSETPOS` ou `RRULE` complexa (ex.: Proton Calendar, que rejeita `RECURRENCE-ID` sem `VEVENT` mestre com `RRULE`). Gera 12 `VEVENT`s individuais com `UID` determinístico por data (`<slug>-<timestampUTC>@<dominio>`), sem `RRULE`, sem `EXDATE`, sem `RECURRENCE-ID`. Exceções entram como `VEVENT` com mesmo `UID` da ocorrência daquela data + `SEQUENCE:1` + `summary` próprio (re-import sobrescreve). `exdates` futuros são **omitidos** (sem `VEVENT` mestre, não há forma RFC-correct de sinalizar remoção — cliente rejeita `STATUS:CANCELLED` + `RECURRENCE-ID` órfão). Consequência: cancelamentos não se propagam no flat; user que quer consistência total deve assinar via `webcal://`. Não é assinável — user re-baixa periodicamente só para atualizar exceções. Só aparece se evento tem `rrule`.

Cada card: header com ícone + `<h3>`, descrição curta (1 linha de microcopy explicando o que faz e o trade-off), CTA (botão com cor do serviço). Hover do card pinta a borda com a cor do serviço.

O card 5 só renderiza se evento tem `rrule` (eventos one-off não têm flat).

Abaixo do grid: `<details class="ajuda-assinar">` com instruções manuais de `webcal://` por cliente (Google, Apple, Outlook, Thunderbird).

## Estrutura do projeto

```
├── _config.ts               # Lume: Liquid plugin + hook afterBuild (gen_ics)
├── deno.json                # tasks: build, serve, dev
├── AGENTS.md
├── content/
│   ├── index.md             # home (lista próximas calls)
│   └── eventos/
│       └── call-makerspace.md   # o evento recorrente (1 arquivo)
├── templates/
│   ├── base.njk             # layout + Vince placeholder
│   ├── index.njk            # lista cronológica de próximas ocorrências
│   └── evento.njk           # página do evento: Entrar na call + grid de 5 cards + ajuda
├── static/
│   └── style.css            # CSS cru
└── plugins/
    └── gen_ics.ts           # hook afterBuild: .md → .ics + .ics flat (RRULE + EXDATE + RECURRENCE-ID)
```

## Hook `gen_ics.ts` (afterBuild)

Responsabilidades, em ordem:
1. Iterar `content/eventos/*.md`, parsear YAML frontmatter (via `@std/yaml`).
2. Para cada evento: construir `.ics` com `npm:ical-generator`:
   - `DTSTART`/`DTEND` em UTC (converter de `-03:00`).
   - `RRULE` passada direta.
   - `EXDATE` para cada item de `exdates[]`.
   - Para cada `excecoes[]`: gerar `VEVENT` extra com mesmo `UID`, `RECURRENCE-ID` apontando pra data da exceção, e `SUMMARY`/`DESCRIPTION` sobrescritos.
3. Escrever `_site/cal/<slug>.ics`.
4. Se evento tem `rrule`: construir também `_site/cal/<slug>-flat.ics` (versão expandida, sem `RRULE`):
   - 12 ocorrências individuais via `expandirOcorrencias`, cada uma `VEVENT` com `UID` determinístico por data (`<slug>-<timestampUTC>@<dominio>`) + `SEQUENCE:0`.
   - `excecoes[]` (todas): `VEVENT` com mesmo `UID` da ocorrência daquela data + `SEQUENCE:1` + `summary`/`description` próprios (re-import sobrescreve).
   - `exdates[]` futuros: **omitidos** (sem `VEVENT` mestre, não há forma RFC-correct de sinalizar remoção — cliente rejeita `STATUS:CANCELLED` + `RECURRENCE-ID` órfão).
   - Eventos sem `rrule` (one-off) **não** geram flat (seria idêntico ao `.ics` normal).
5. Calcular próximas 12 ocorrências com `npm:rrule`, filtrar `exdates`, mesclar `excecoes`. Expor no `page.data`: `proximas_ocorrencias` (array completo, embarcado como JSON inline na home/hero), `proxima_ocorrencia` (1ª futura), `excecoes_futuras` e `exdates_futuros` (só datas >= hoje, pró template renderizar as seções 2 e 3).

## Comandos

- `deno task dev` — servidor local com hot reload
- `deno task build` — build produção em `_site/`
- `deno task serve` — serve `_site/` localmente pra teste

## Validação manual (sempre após mexer em `.ics`)

1. `deno task build` → confirmar que `_site/cal/*.ics` foi gerado (e `_site/cal/<slug>-flat.ics` para eventos com `rrule`).
2. `deno task serve` → abrir `http://localhost:3000/cal/<slug>.ics` no browser, deve baixar arquivo `.ics` válido (não renderizar como texto).
3. Importar o `.ics` no Google Calendar (Add by URL com `https://...`) e no Apple Calendar (Add subscription com `webcal://...`).
4. Editar `exdates` no `.md`, rebuildar, re-add → confirmar que a ocorrência cancelada some.
5. Editar `excecoes` no `.md`, rebuildar → confirmar que o título da ocorrência modificada aparece no calendário.
6. Importar `_site/cal/<slug>-flat.ics` no Proton Calendar → todas as 12 ocorrências devem entrar; `excecoes` devem mostrar o `titulo` próprio. `exdates` futuros não aparecem (omitidos por design — ver docstring de `gerarIcsFlat`).

## Fonts de verdade (sempre consultar)

APIs do Lume e das libs mudam. **Sempre que houver dúvida sobre API, syntax, ou config, consultar o Context7 antes de inventar:**

- **Lume (SSG Deno):** Context7 library ID `/lumeland/lume.land`
  - Use para: `_config.ts`, plugins, `addEventListener`, `preprocess`, `site.data`, template engines, `loadData`, page data model.
- **ical-generator:** não está no Context7; consultar README no npm (https://www.npmjs.com/package/ical-generator) via `jina-mcp-server_read_url` quando precisar de API de `Calendar`/`Event`/`repetition`/`recurrenceId`.
- **rrule (lib):** não está no Context7; consultar README no npm (https://www.npmjs.com/package/rrule) quando precisar de `RRule.fromString()` / `.between()` / expansão de ocorrências.
- **Liquid:** filtros e syntax padrão. Se dúvida, consultar a doc oficial https://shopify.github.io/liquid/ via `jina-mcp-server_read_url`.

## O que NÃO fazer

- Não adicionar JavaScript client-side **extra**: o snippet inline no `base.njk` é o único permitido (destacar próxima ocorrência, esconder passadas, badge AO VIVO). Sem fetch nos botões, sem SPA, sem framework JS, sem hidratação.
- Não introduzir biblioteca de `rrule` client-side. A expansão vem do build; o JS só reordena/filtra o que já está no HTML via `data-attribute`.
- Não introduzir framework CSS (sem Tailwind, sem Bootstrap). CSS cru em `static/style.css`.
- Não criar 1 `.md` por ocorrência de evento recorrente. Usar `rrule`.
- Não hospedar o `.ics` fora do `_site/`. O Cloudflare Pages serve pela extensão com `Content-Type: text/calendar` automaticamente.
- Não commitar `_site/` (gerado em build). Adicionar ao `.gitignore`.
- Não configurar Vince agora — o `<script>` fica comentado no `base.njk` como placeholder.
- Não implementar RSVP backend no MVP. Se aparecer a necessidade, fase 2 = Cloudflare Worker + KV.