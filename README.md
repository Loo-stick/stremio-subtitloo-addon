# Subtitles FR - Addon Stremio

Addon Stremio pour recuperer des sous-titres francais depuis plusieurs sources.

## Nouveaute v1.4.0 : Info disponibilite

L'addon affiche maintenant sur la fiche du film/serie si des sous-titres francais sont disponibles, en verifiant sur **les 3 sources** (OpenSubtitles, SubDL, YIFY) :

- `Sous-titres FR disponibles (OS:5, SubDL:3, YIFY:2)` - Details par source
- `Pas de sous-titres FR disponibles` - Aucun sous-titre trouve

Cette info est cachee pendant 7 jours pour eviter les appels API repetes.

## Sources supportees

| Source | Contenu | API Key | Prefixe |
|--------|---------|---------|---------|
| **OpenSubtitles** | Films + Series | [Obtenir](https://www.opensubtitles.com/consumers) | `[OS]` |
| **SubDL** | Films + Series | [Obtenir](https://subdl.com) | `[SubDL]` |
| **YIFY** | Films uniquement | Aucune requise | `[YIFY]` |

## Optimisations (v1.3.0)

- **Proxy pour OpenSubtitles** : Le lien de telechargement n'est resolu que quand vous cliquez sur un sous-titre (economise 90% des appels API)
- **Cache des liens** : Les liens OpenSubtitles sont caches pendant 3h
- **Limite a 5 resultats** par source pour eviter le rate limiting
- **Fail fast sur 429** : Arret immediat en cas de rate limit

## Prerequis

- Node.js >= 14.0.0
- Au moins une source active (YIFY fonctionne sans cle API)

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

4. Editez le fichier `.env`:
```bash
# IMPORTANT: URL publique de votre addon
# Local: http://localhost:7000
# Render: https://votre-app.onrender.com
ADDON_URL=http://localhost:7000

# Sources (optionnel si vous utilisez seulement YIFY)
OPENSUBTITLES_API_KEY=votre_cle
SUBDL_API_KEY=votre_cle

# YIFY est active par defaut
ENABLE_YIFY=true
```

## Deploiement sur Render

1. Creez un nouveau Web Service sur [Render](https://render.com)
2. Connectez votre repo GitHub
3. Configurez les variables d'environnement:
   - `ADDON_URL` = `https://votre-app.onrender.com` (IMPORTANT!)
   - `OPENSUBTITLES_API_KEY` = votre cle
   - `SUBDL_API_KEY` = votre cle
   - `PORT` = `7000`
4. Deploy!

## Demarrage local

```bash
npm start
```

L'addon sera accessible sur `http://localhost:7000`

## Installation dans Stremio

1. Demarrez l'addon
2. Ouvrez Stremio
3. Allez dans **Addons** > **Community Addons**
4. Collez l'URL: `http://localhost:7000/manifest.json` (ou votre URL Render)
5. Cliquez sur **Install**

## Affichage dans Stremio

Les sous-titres sont affiches avec leur source :

```
[OS] [1234↓] NomDeLaRelease        <- OpenSubtitles
[SubDL] NomDeLaRelease             <- SubDL
[YIFY] [★8] NomDeLaRelease         <- YIFY
```

## Architecture

```
stremio-subtitles-fr/
├── index.js                    # Serveur Express + Stremio SDK
├── lib/
│   ├── opensubtitles.js        # Client API + cache + proxy
│   ├── subtitle-checker.js     # Verificateur dispo multi-sources
│   ├── cinemeta.js             # Client API Cinemeta
│   ├── cache.js                # Cache persistant JSON
│   ├── subdl.js                # Client API SubDL
│   └── yify.js                 # Client API YIFY
├── data/
│   └── cache.json              # Cache des verifications (gitignore)
├── .env.example
├── .env                        # Credentials (gitignore)
├── .gitignore
├── package.json
└── README.md
```

## Variables d'environnement

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `ADDON_URL` | URL publique de l'addon | **Oui** |
| `OPENSUBTITLES_API_KEY` | Cle API OpenSubtitles | Non |
| `OPENSUBTITLES_USER_AGENT` | User-Agent custom | Non |
| `SUBDL_API_KEY` | Cle API SubDL | Non |
| `ENABLE_YIFY` | Activer YIFY (defaut: true) | Non |
| `ENABLE_META` | Activer info dispo sur fiche (defaut: true) | Non |
| `CACHE_TTL_DAYS` | Duree du cache en jours (defaut: 7) | Non |
| `PORT` | Port du serveur (defaut: 7000) | Non |

## Routes utiles

| Route | Description |
|-------|-------------|
| `/health` | Statut de l'addon |
| `/stats` | Statistiques du cache |
| `/cache/clear` | Vider le cache |
| `/cache/invalidate/:imdbId` | Invalider une entree (ex: `/cache/invalidate/tt1234567`) |

## Comment ca marche (OpenSubtitles)

```
1. Stremio demande les sous-titres
   └─> Addon retourne des URLs proxy: /proxy/os/{file_id}

2. Utilisateur clique sur un sous-titre
   └─> Stremio appelle: https://addon.com/proxy/os/12345

3. Proxy resout le lien (1 seul appel API)
   └─> Appelle OpenSubtitles /download
   └─> Cache le resultat 3h
   └─> Redirige vers le .srt
```

**Avant** : 1 recherche + N downloads = N+1 appels API
**Apres** : 1 recherche + 1 download = 2 appels API

## Licence

MIT
