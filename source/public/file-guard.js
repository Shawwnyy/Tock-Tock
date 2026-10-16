// Ce fichier index.html est le SOURCE du projet : il doit être compilé (npm run dev / npm run build).
// Ouvert directement depuis le disque (file://), il afficherait une page blanche : on explique quoi faire à la place.
if (location.protocol === 'file:') {
  document.getElementById('root').innerHTML =
    '<div style="font:18px system-ui;max-width:560px;margin:3rem auto;padding:0 1rem">' +
    '<h1>Tock Tock</h1><p>Ce fichier est le code source : il ne s\'ouvre pas directement.</p>' +
    '<p>➜ Ouvre <strong>Tock Tock.html</strong> (à la racine du dossier) par double-clic, ou lance <code>npm run build:local</code>.</p></div>';
}
