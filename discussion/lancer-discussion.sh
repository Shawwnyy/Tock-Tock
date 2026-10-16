#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js est introuvable : installe-le depuis https://nodejs.org"; exit 1; }
node serveur.mjs
