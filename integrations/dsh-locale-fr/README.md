# Français pour DeepSeek Harness (`dsh web`)

Ce pack de langue ajoute le **français** à l'interface web de DeepSeek Harness. C'est un plugin
client officiellement pris en charge par le harness (`ctx.locale.addLanguage`), donc **aucun fork**
n'est nécessaire et le pack reste compatible avec les mises à jour du harness.

- 57 espaces de noms, 2 602 textes, tous traduits.
- Traductions vérifiées : chaque clé anglaise a sa traduction et les `{variables}` sont identiques.
- Typographie française : espace insécable avant `: ; ? !` et à l'intérieur des « guillemets ».
- Si une nouvelle version du harness ajoute des textes non traduits, ils s'affichent en anglais
  (repli prévu par le harness), jamais sous forme de clé brute.

## Installation

Il faut `pnpm` dans le `PATH`, car `dsh plugin` s'en sert.

```bash
dsh plugin --profile web add "/chemin/vers/Smart Delegate/integrations/dsh-locale-fr/dist"
dsh web
```

Ensuite, dans l'interface, ouvre **Settings → General → Language** et choisis **Français**.

Pour le désinstaller :

```bash
dsh plugin --profile web remove @local/dsh-locale-fr
```

## Vérifié

Test fait avec `@deepseek-ai/dsh` 0.2.0-rc.2, dans un `DSH_HOME` isolé :

- `dsh plugin add` inscrit le pack comme bundle du profil `web` ;
- `dsh web` démarre sans erreur ;
- le module client du pack figure dans la page et il est servi au navigateur ;
- l'API `addLanguage` est présente dans le runtime client.

L'affichage final dans un navigateur n'a pas encore été vérifié visuellement.

## Mettre à jour après une nouvelle version du harness

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh-src
npm run extract -- /tmp/dsh-src source/en-dicts.json   # textes anglais à jour
npm run check                                           # liste ce qui manque ou a changé
# traduire les clés manquantes dans fr/part-*.json
npm run build                                           # régénère dist/
```

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `source/en-dicts.json` | Textes anglais extraits du harness (référence des clés et des variables) |
| `fr/part-*.json` | Traductions françaises, par espace de noms |
| `scripts/extract.mjs` | Extrait les dictionnaires anglais des sources TypeScript du harness (sans compilation) |
| `scripts/build.mjs` | Vérifie les traductions et génère le plugin dans `dist/` |
| `dist/` | Plugin prêt à installer (généré, versionné pour pouvoir l'installer sans étape de build) |
