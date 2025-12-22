# Subtitles FR - Addon Stremio

Addon Stremio pour recuperer des sous-titres francais depuis plusieurs sources.

## Sources supportees

| Source | Description | API Key |
|--------|-------------|---------|
| **OpenSubtitles** | La plus grande base de sous-titres | [Obtenir](https://www.opensubtitles.com/consumers) |
| **SubDL** | Base alternative avec contenu different | [Obtenir](https://subdl.com) |

> Au moins une source doit etre configuree pour que l'addon fonctionne.

## Fonctionnalites

- Recherche sur plusieurs sources en parallele
- Sous-titres francais uniquement
- Support des films et series (avec gestion saison/episode)
- Tri par popularite (nombre de telechargements)
- Retourne jusqu'a 15 sous-titres par source
- Gestion du rate limiting avec retry automatique

## Prerequis

- Node.js >= 14.0.0
- Au moins une cle API (OpenSubtitles ou SubDL)

## Installation

1. Clonez ou telechargez ce projet

2. Installez les dependances:
```bash
npm install
```

3. Configurez vos credentials:
```bash
cp .env.example .env
```

4. Editez le fichier `.env` et ajoutez vos cles API:
```bash
# Au moins une des deux sources
OPENSUBTITLES_API_KEY=votre_cle_opensubtitles
SUBDL_API_KEY=votre_cle_subdl
```

## Obtenir les cles API

### OpenSubtitles
1. Creez un compte sur [OpenSubtitles](https://www.opensubtitles.com)
2. Allez dans [API Consumers](https://www.opensubtitles.com/consumers)
3. Creez une nouvelle application
4. Copiez votre API Key

### SubDL
1. Creez un compte sur [SubDL](https://subdl.com)
2. Allez dans les parametres de votre compte
3. Generez une cle API
4. Copiez votre API Key

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

## Utilisation

Une fois installe, l'addon fournira automatiquement les sous-titres francais quand vous regardez un film ou une serie dans Stremio.

Les sous-titres affichent:
- La source (OpenSubtitles ou SubDL)
- Le nombre de telechargements (indicateur de qualite)
- Le nom de la release
- L'uploadeur

## Structure du projet

```
stremio-subtitles-fr/
├── index.js              # Point d'entree, config addon
├── lib/
│   ├── opensubtitles.js  # Client API OpenSubtitles
│   └── subdl.js          # Client API SubDL
├── .env.example          # Template des variables
├── .env                  # Credentials (gitignore)
├── .gitignore
├── package.json
└── README.md
```

## Variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `OPENSUBTITLES_API_KEY` | Cle API OpenSubtitles | Non* |
| `OPENSUBTITLES_USER_AGENT` | User-Agent custom | Non |
| `SUBDL_API_KEY` | Cle API SubDL | Non* |
| `PORT` | Port du serveur | Non (defaut: 7000) |

\* Au moins une des deux cles API doit etre configuree.

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
3. Ajouter le client dans `index.js`
4. Mettre a jour `.env.example` et `README.md`

## Licence

MIT
