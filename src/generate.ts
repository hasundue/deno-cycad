import { distinct } from "https://deno.land/std@0.204.0/collections/distinct.ts";
import $ from "https://deno.land/x/dax@0.35.0/mod.ts";
import {
  ensure,
  is,
  PredicateType,
} from "https://deno.land/x/unknownutil@v3.10.0/mod.ts";
import { throw_ } from "./utils.ts";

export async function fetchGrammarList() {
  const response = await fetch(
    `https://api.github.com/repos/NixOS/nixpkgs/contents/pkgs/development/tools/parsing/tree-sitter/grammars`,
  );
  const json = ensure(
    await response.json(),
    is.ArrayOf(is.ObjectOf({ name: is.String })),
  );
  return json.filter((item) => item.name.endsWith(".json"))
    .map((item) => item.name);
}

function parseGrammerName(filename: string) {
  return filename.split("-")[2].split(".")[0];
}

function createLanguageList(grammars: string[]) {
  return distinct(
    grammars.map((g) => parseGrammerName(g))
      .concat(Object.keys(LanguageSpecOverlays)),
  ).sort();
}

interface LanguageSpecOverlay {
  grammar?: string;
  language?: string;
  location?: string;
  generate?: boolean;
}

// Hard-ported from https://github.com/NixOS/nixpkgs/blob/master/pkgs/development/tools/parsing/tree-sitter/default.nix
const LanguageSpecOverlays: Record<string, LanguageSpecOverlay | undefined> = {
  ocaml: {
    grammar: "ocaml",
    location: "ocaml",
  },
  "ocaml-interface": {
    grammar: "ocaml",
    location: "interface",
  },
  "org-nvim": {
    language: "org",
  },
  typescript: {
    grammar: "typescript",
    location: "typescript",
  },
  tsx: {
    grammar: "typescript",
    location: "tsx",
  },
  typst: {
    generate: true,
  },
  markdown: {
    grammar: "markdown",
    location: "tree-sitter-markdown",
  },
  "markdown-inline": {
    grammar: "markdown",
    language: "markdown_inline",
    location: "tree-sitter-markdown-inline",
  },
  wing: {
    location: "libs/tree-sitter-wing",
    generate: true,
  },
};

const isGrammarJson = is.ObjectOf({
  url: is.String,
  fetchLFS: is.OptionalOf(is.Boolean),
  fetchSubmodules: is.OptionalOf(is.Boolean),
  deepClone: is.OptionalOf(is.Boolean),
});

type GrammarJson = Required<PredicateType<typeof isGrammarJson>> & {
  grammar: string;
};

async function fetchGrammarJson(
  grammar: string,
): Promise<GrammarJson> {
  const response = await fetch(
    `https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/development/tools/parsing/tree-sitter/grammars/${grammar}`,
  );
  if (!response.ok) {
    throw new Error(
      `Could not find tree-sitter grammer for ${grammar} in nixpkgs`,
    );
  }
  const json = ensure(
    await response.json(),
    isGrammarJson,
  );
  return {
    grammar: parseGrammerName(grammar),
    url: json.url,
    fetchLFS: json.fetchLFS ?? false,
    fetchSubmodules: json.fetchSubmodules ?? false,
    deepClone: json.deepClone ?? false,
  };
}

async function fetchGrammarJsons(
  grammars: string[],
): Promise<GrammarJson[]> {
  const jsons: GrammarJson[] = [];
  const progbar = $.progress({ length: grammars.length });
  await progbar.with(async () => {
    // We can't use Promise.all because GitHub will rate limit us
    for (const grammar of grammars) {
      jsons.push(await fetchGrammarJson(grammar));
      progbar.increment();
    }
  });
  return jsons;
}

type LanguageSpec = GrammarJson & Required<Omit<LanguageSpecOverlay, "name">>;

type LanguageSpecMap = Record<string, LanguageSpec>;

export async function createLanguageSpecMap(): Promise<LanguageSpecMap> {
  const grammars = await fetchGrammarList();
  const jsons = await fetchGrammarJsons(grammars);
  const languages = createLanguageList(grammars);

  return Object.fromEntries(languages.map((language) => {
    const overlay = LanguageSpecOverlays[language];
    const grammar = overlay?.grammar ?? overlay?.language ?? language;
    const json = jsons.find((j) => j.grammar === grammar) ??
      throw_(new Error(`Could not find grammar for ${language}`));
    return [
      language,
      {
        ...json,
        language: overlay?.language ?? language,
        location: overlay?.location ?? ".",
        generate: overlay?.generate ?? false,
      },
    ];
  }));
}

async function generateLanguageSpecModule() {
  const content = `
// Generated by src/langs.ts (do not edit manually)

export const LanguageSpecMap = ${
    JSON.stringify(await createLanguageSpecMap(), null, 2)
  } as const;

export type Language = keyof typeof LanguageSpecMap;
`;
  await Deno.writeTextFile(
    new URL("./langs.generated.ts", import.meta.url),
    content,
  );
  $.cd(import.meta);
  await $`deno fmt ./langs.generated.ts`.stderr("null");
}

if (import.meta.main) {
  try {
    await generateLanguageSpecModule();
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
