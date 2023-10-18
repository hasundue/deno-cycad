import $ from "https://deno.land/x/dax@0.35.0/mod.ts";
import { Language, LanguageSpecMap } from "./langs.generated.ts";
import { getLanguageDir, getVendorDir, TREE_SITTER } from "./paths.ts";

async function buildParser(lang: Language) {
  const spec = LanguageSpecMap[lang];
  const cache = getVendorDir(lang);
  try {
    // Clone repository
    await $`mkdir -p ${cache}`;
    await $.progress(`Cloning ${lang} repository`)
      .with(async () => await $`git clone ${spec.url} ${cache}`.quiet());
  } catch {
    // Update if already cloned
    await $.progress(`Updating ${lang} repository`)
      .with(async () =>
        await $`git -C ${cache} pull`.stdout("null").stderr("inherit")
      );
  }
  $.cd(getLanguageDir(lang));
  await $.progress(`Building ${lang} parser`)
    .with(async () => await $`${TREE_SITTER} build-wasm`);
}

if (import.meta.main) {
  try {
    for (const lang of Deno.args) {
      await buildParser(lang as Language);
    }
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
