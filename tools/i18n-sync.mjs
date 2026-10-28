// Rewrites js/locales/*.js to the keys the game uses (tests/i18n-keys.mjs: js/ and native/ T() / N()
// calls, the session's breakdown rows, the content tables): stray keys are pruned and the new
// translations below added. Run after adding strings, then `npm test`.
//   node tools/i18n-sync.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { ALL } from '../tests/i18n-keys.mjs';
import EN_GB from '../js/locales/en-GB.js';
import { ES_419, ES_ES } from '../js/locales/es.js';
import DE_DE from '../js/locales/de.js';
import { FR_FR, FR_CA } from '../js/locales/fr.js';
import PT_BR from '../js/locales/pt.js';
import IT_IT from '../js/locales/it.js';

// New strings of the engine client: [de, es-419, fr, pt-BR, it].
const NEW = {
  'Progress restored from your StarHermit cloud save.': ['Fortschritt aus deinem StarHermit-Cloud-Speicher wiederhergestellt.', 'Progreso restaurado desde tu guardado en la nube de StarHermit.', 'Progression restaurée depuis ta sauvegarde cloud StarHermit.', 'Progresso restaurado do seu salvamento na nuvem do StarHermit.', 'Progressi ripristinati dal tuo salvataggio cloud StarHermit.'],
  '{suit}: {n}/13': ['{suit}: {n}/13', '{suit}: {n}/13', '{suit} : {n}/13', '{suit}: {n}/13', '{suit}: {n}/13'],
  'Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options.': [
    'Ton, Grafik, Sprache, größere Schrift, hoher Kontrast und reduzierte Bewegung findest du in den StarHermit-Optionen.',
    'El sonido, los gráficos, el idioma, el texto más grande, el alto contraste y el movimiento reducido están en las Opciones de StarHermit.',
    'Le son, les graphismes, la langue, le texte agrandi, le contraste élevé et les animations réduites sont dans les Options StarHermit.',
    'Som, gráficos, idioma, texto maior, alto contraste e movimento reduzido ficam nas Opções do StarHermit.',
    'Audio, grafica, lingua, testo più grande, contrasto elevato e movimento ridotto sono nelle Opzioni di StarHermit.'],
  'Open Options': ['Optionen öffnen', 'Abrir opciones', 'Ouvrir les options', 'Abrir opções', 'Apri opzioni'],
  'Key bindings': ['Tastenbelegung', 'Asignación de teclas', 'Raccourcis clavier', 'Atalhos de teclado', 'Assegnazione tasti'],
  'Mirrors the action tray.': ['Spiegelt die Aktionsleiste.', 'Invierte la bandeja de acciones.', 'Inverse la barre d’actions.', 'Espelha a barra de ações.', 'Inverte la barra delle azioni.'],
  'Vibration feedback on supporting devices.': ['Vibrationsfeedback auf unterstützten Geräten.', 'Vibración en los dispositivos compatibles.', 'Retour par vibration sur les appareils compatibles.', 'Vibração em dispositivos compatíveis.', 'Vibrazione sui dispositivi compatibili.'],
};


const keep = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => ALL.has(k)));
const withNew = (d, i) => { const o = keep(d); for (const [k, v] of Object.entries(NEW)) if (!(k in o)) o[k] = v[i]; return o; };
const body = (d) => Object.entries(d).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
const header = (file) => readFileSync(new URL(`../js/locales/${file}`, import.meta.url), 'utf8').split('\n')[0];
const write = (file, text) => writeFileSync(new URL(`../js/locales/${file}`, import.meta.url), `${header(file)}\n${text}`);

write('de.js', `export default {\n${body(withNew(DE_DE, 0))}\n};\n`);
write('es.js', `export const ES_419 = {\n${body(withNew(ES_419, 1))}\n};\nexport const ES_ES = {\n${body(keep(ES_ES))}\n};\n`);
write('fr.js', `export const FR_FR = {\n${body(withNew(FR_FR, 2))}\n};\nexport const FR_CA = {\n${body(keep(FR_CA))}\n};\n`);
write('pt.js', `export default {\n${body(withNew(PT_BR, 3))}\n};\n`);
write('it.js', `export default {\n${body(withNew(IT_IT, 4))}\n};\n`);
write('en-GB.js', `export default {\n${body(keep(EN_GB))}\n};\n`);
console.log('locales synced');
