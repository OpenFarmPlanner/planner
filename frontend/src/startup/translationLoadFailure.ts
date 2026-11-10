import { reloadPage, shouldAutomaticallyReloadForChunkError } from '../runtime/chunkLoadErrors';

/**
 * Shown when neither the visitor's language nor English could be downloaded
 * (`i18nReady` rejected). With no translations available this one message is
 * deliberately inline, in all four UI languages, instead of in a locale file.
 */
const MESSAGE_LINES = [
  'OpenFarmPlanner konnte nicht geladen werden. Prüfe deine Verbindung und lade die Seite neu.',
  'OpenFarmPlanner could not be loaded. Check your connection and reload the page.',
  "OpenFarmPlanner n'a pas pu être chargé. Vérifiez votre connexion et rechargez la page.",
  'No se pudo cargar OpenFarmPlanner. Comprueba tu conexión y vuelve a cargar la página.',
];

export function handleTranslationLoadFailure(error: unknown): void {
  console.error('Translations could not be loaded:', error);
  // Most often a deploy replaced the language chunk under an open tab: one
  // reload fetches the new one (the same guard as other chunk errors).
  if (shouldAutomaticallyReloadForChunkError()) {
    reloadPage();
    return;
  }
  const root = document.getElementById('root');
  if (!root) return;
  const container = document.createElement('div');
  container.setAttribute('role', 'alert');
  container.style.cssText = 'max-width:640px;margin:48px auto;padding:0 16px;font-family:sans-serif;line-height:1.5';
  for (const line of MESSAGE_LINES) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    container.appendChild(paragraph);
  }
  root.replaceChildren(container);
}
