# OpenSubtitles FR - Addon Stremio

Addon Stremio pour recuperer des sous-titres francais depuis OpenSubtitles.

## Fonctionnalites

- Recherche de sous-titres francais uniquement
- Support des films et series (avec gestion saison/episode)
- Tri par popularite (nombre de telechargements)
- Retourne jusqu'a 15 sous-titres par contenu
- Gestion du rate limiting avec retry automatique

## Prerequis

- Node.js >= 14.0.0
- Un compte OpenSubtitles avec une cle API

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

4. Editez le fichier `.env` et ajoutez votre cle API OpenSubtitles:
```
OPENSUBTITLES_API_KEY=votre_cle_api
OPENSUBTITLES_USER_AGENT=stremio-subtitles-fr v1.0
PORT=7000
```

## Obtenir une cle API OpenSubtitles

1. Creez un compte sur [OpenSubtitles](https://www.opensubtitles.com)
2. Allez dans [API Consumers](https://www.opensubtitles.com/consumers)
3. Creez une nouvelle application
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

Les sous-titres sont affiches avec:
- Le nombre de telechargements (indicateur de qualite)
- Le nom de la release
- L'uploadeur

## Structure du projet

```
stremio-opensubtitles-fr/
├── index.js              # Point d'entree, config addon
├── lib/
│   └── opensubtitles.js  # Client API OpenSubtitles
├── .env.example          # Template des variables
├── .env                  # Credentials (gitignore)
├── .gitignore
├── package.json
└── README.md
```

## Variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `OPENSUBTITLES_API_KEY` | Cle API OpenSubtitles | Oui |
| `OPENSUBTITLES_USER_AGENT` | User-Agent custom | Non (defaut: stremio-subtitles-fr v1.0) |
| `PORT` | Port du serveur | Non (defaut: 7000) |

## Debug

L'addon affiche des logs dans la console pour faciliter le debug:
- Recherches lancees
- Nombre de resultats trouves
- Erreurs API

## Licence

MIT
