import lume from "lume/mod.ts";
import date from "lume/plugins/date.ts";
import nunjucks from "lume/plugins/nunjucks.ts";
import slugify_urls from "lume/plugins/slugify_urls.ts";
import metas from "lume/plugins/metas.ts";
import sitemap from "lume/plugins/sitemap.ts";
import gen_ics from "./plugins/gen_ics.ts";

const site = lume({
  location: new URL("https://calendario.riomakerspace.com.br/"),
});

site.ignore("AGENTS.md");
site.add("static", ".");

site.use(date());
site.use(nunjucks());
site.use(slugify_urls());
site.use(metas());
site.use(sitemap());
site.use(gen_ics);

export default site;
