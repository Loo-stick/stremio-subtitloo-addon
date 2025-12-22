# Subtitles FR - Addon Stremio

Addon Stremio pour recuperer des sous-titres francais depuis plusieurs sources.

## Sources supportees

| Source | Contenu | API Key | Prefixe affiche |
|--------|---------|---------|-----------------|
| **OpenSubtitles** | Films + Series | [Obtenir](https://www.opensubtitles.com/consumers) | `[OS]` |
| **SubDL** | Films + Series | [Obtenir](https://subdl.com) | `[SubDL]` |
| **YIFY** | Films uniquement | Aucune requise | `[YIFY]` |

> YIFY est active par defaut sans configuration. Pour les series, configurez OpenSubtitles ou SubDL.

## Fonctionnalites

- Recherche sur plusieurs sources en parallele
- Sous-titres francais uniquement
- Support des films et series (avec gestion saison/episode)
- Affichage de la source pour chaque sous-titre
- Tri par popularite/rating
- Retourne jusqu'a 15 sous-titres par source
- Gestion du rate limiting avec retry automatique

## Prerequis

- Node.js >= 14.0.0
- Au moins une source active (YIFY fonctionne sans cle API)

## Installation

1. Clonez ou telechargez ce projet

2. Installez les dependances:
```bash
npm install
```

3. Configurez vos credentials (optionnel si vous utilisez seulement YIFY):
```bash
cp .env.example .env
```

4. Editez le fichier `.env`:
```bash
# Optionnel - pour films + series
OPENSUBTITLES_API_KEY=votre_cle_opensubtitles
SUBDL_API_KEY=votre_cle_subdl

# YIFY est active par defaut (films uniquement)
ENABLE_YIFY=true
```

## Obtenir les cles API

### OpenSubtitles (recommande pour les series)
1. Creez un compte sur [OpenSubtitles](https://www.opensubtitles.com)
2. Allez dans [API Consumers](https://www.opensubtitles.com/consumers)
3. Creez une nouvelle application
4. Copiez votre API Key

### SubDL
1. Creez un compte sur [SubDL](https://subdl.com)
2. Allez dans [Panel API](https://subdl.com/panel/api)
3. Copiez votre API Key

### YIFY
Aucune cle requise ! Active par defaut.

## Demarrage

```bash
npm start
```

L'addon sera accessible sur `http://localhost:7000`

## Installation dans Stremio

1. Demarrez l'addon avec `npm start`
2. Ouvrez Stremio
3. Allez dans **Addons** > **Community Addons**
4. Cliquez sur l'icone d'ajout (en haut a droite)
5. Collez l'URL: `http://localhost:7000/manifest.json`
6. Cliquez sur **Install**

## Affichage dans Stremio

Les sous-titres sont affiches avec leur source identifiable :

```
[OS] [1234↓] NomDeLaRelease        <- OpenSubtitles (avec downloads)
[SubDL] NomDeLaRelease             <- SubDL
[YIFY] [★8] NomDeLaRelease         <- YIFY (avec rating)
```

## Structure du projet

```
stremio-subtitles-fr/
├── index.js              # Point d'entree, config addon
├── lib/
│   ├── opensubtitles.js  # Client API OpenSubtitles
│   ├── subdl.js          # Client API SubDL
│   └── yify.js           # Client API YIFY
├── .env.example          # Template des variables
├── .env                  # Credentials (gitignore)
├── .gitignore
├── package.json
└── README.md
```

## Variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `OPENSUBTITLES_API_KEY` | Cle API OpenSubtitles | Non |
| `OPENSUBTITLES_USER_AGENT` | User-Agent custom | Non |
| `SUBDL_API_KEY` | Cle API SubDL | Non |
| `ENABLE_YIFY` | Activer YIFY (defaut: true) | Non |
| `PORT` | Port du serveur | Non (defaut: 7000) |

## Debug

L'addon affiche des logs dans la console pour faciliter le debug:
- Sources activees au demarrage
- Recherches lancees sur chaque source
- Nombre de resultats trouves par source
- Erreurs API

## Ajouter une nouvelle source

Pour ajouter une nouvelle source de sous-titres:

1. Creer un nouveau fichier dans `lib/` (ex: `lib/newsource.js`)
2. Implementer les methodes `searchSubtitles()` et `formatForStremio()`
3. Ajouter un prefixe unique dans `SubDisplayTitle` (ex: `[NEW]`)
4. Ajouter le client dans `index.js`
5. Mettre a jour `.env.example` et `README.md`

## Licence

MIT
