const IGDB_URL = "https://api.igdb.com/v4";

export async function igdbFetch(endpoint: string, query: string) {
  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": import.meta.env.IGDB_CLIENT_ID,
      "Authorization": `Bearer ${import.meta.env.IGDB_ACCESS_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: query,
  });

  if (!res.ok) return null;
  return res.json();
}

export async function getGameDetails(igdbId: number) {
  const [_, involvedCompanies, genres, gameModes, themes, 
         franchises, engines, alternativeTitles, keywords] = await Promise.all([

    igdbFetch("games", `
      fields name, summary, first_release_date,
              involved_companies, genres, game_modes,
              themes, franchises, game_engines,
              alternative_names, keywords;
      where id = ${igdbId};
      limit 1;
    `),

    igdbFetch("involved_companies", `
      fields company.name, company.slug, developer, publisher, supporting;
      where game = ${igdbId};
      limit 20;
    `),

    igdbFetch("genres", `
      fields name, slug;
      where game = (${igdbId});
      limit 10;
    `),

    igdbFetch("game_modes", `
      fields name, slug;
      where games = (${igdbId});
      limit 10;
    `),

    igdbFetch("themes", `
      fields name, slug;
      where games = (${igdbId});
      limit 10;
    `),

    igdbFetch("franchises", `
      fields name, slug;
      where games = (${igdbId});
      limit 5;
    `),

    igdbFetch("game_engines", `
      fields name, slug;
      where games = (${igdbId});
      limit 5;
    `),

    igdbFetch("alternative_names", `
      fields name, comment;
      where game = ${igdbId};
      limit 10;
    `),

    igdbFetch("keywords", `
      fields name, slug;
      where games = (${igdbId});
      limit 20;
    `),
  ]);

  // Parse involved companies into roles
  const companies: {
  main_developers: any[];
  supporting_developers: any[];
  publishers: any[];
} = {
  main_developers: [],
  supporting_developers: [],
  publishers: [],
};

  if (involvedCompanies) {
    for (const ic of involvedCompanies) {
      if (!ic.company) continue;
      if (ic.developer && !ic.supporting) companies.main_developers.push(ic.company);
      if (ic.supporting) companies.supporting_developers.push(ic.company);
      if (ic.publisher) companies.publishers.push(ic.company);
    }
  }

  return {
    companies,
    genres: genres ?? [],
    game_modes: gameModes ?? [],
    themes: themes ?? [],
    franchises: franchises ?? [],
    engines: engines ?? [],
    alternative_titles: alternativeTitles ?? [],
    keywords: keywords ?? [],
  };
}
