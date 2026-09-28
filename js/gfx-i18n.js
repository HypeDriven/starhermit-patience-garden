// Patience Garden — strings for the Graphics settings section.
// The rest of the game ships in English; this panel follows the browser
// language (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT).

const EN = {
  section: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  fromPreset: 'From preset ({tier})',
  renderScale: 'Render scale',
  adaptive: 'Adaptive resolution',
  adaptiveNote: 'Lowers the resolution when frames are slow, raises it again when they are fast.',
  showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device; the table renders without it.',
  noRenderer: 'Graphics apply to the 3D glasshouse table.',
  unknownGpu: 'unknown GPU',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  cats: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail',
    particles: 'Particles', background: 'Background',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
    static: 'Static', animated: 'Animated',
  },
  words: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', ibl: 'reflections' },
};

const ES = {
  section: 'Gráficos',
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  fromPreset: 'Según el ajuste ({tier})',
  renderScale: 'Escala de renderizado',
  adaptive: 'Resolución adaptable',
  adaptiveNote: 'Baja la resolución cuando los fotogramas van lentos y la sube cuando van rápidos.',
  showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; la mesa se muestra sin él.',
  noRenderer: 'Los gráficos se aplican a la mesa 3D del invernadero.',
  unknownGpu: 'GPU desconocida',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Suavizado de bordes', reflections: 'Reflejos', detail: 'Detalle de superficies',
    particles: 'Partículas', background: 'Fondo',
  },
  tiers: {
    off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Sencillo', detailed: 'Detallado',
    static: 'Estático', animated: 'Animado',
  },
  words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', noAa: 'sin suavizado', ibl: 'reflejos' },
};

const FR = {
  section: 'Graphismes',
  quality: 'Qualité',
  auto: 'Auto (détectée : {tier})',
  fromPreset: 'Selon le préréglage ({tier})',
  renderScale: 'Échelle de rendu',
  adaptive: 'Résolution adaptative',
  adaptiveNote: 'Baisse la résolution quand les images ralentissent, la remonte quand elles sont rapides.',
  showFps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; la table s’affiche sans.',
  noRenderer: 'Les graphismes s’appliquent à la table 3D de la serre.',
  unknownGpu: 'GPU inconnu',
  presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces',
    particles: 'Particules', background: 'Arrière-plan',
  },
  tiers: {
    off: 'Désactivé', on: 'Activé', low: 'Basses', medium: 'Moyennes', high: 'Hautes',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
    static: 'Statique', animated: 'Animé',
  },
  words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'halo', noAa: 'sans anticrénelage', ibl: 'reflets' },
};

const STRINGS = {
  'en-US': { ...EN, cats: { ...EN.cats, grade: 'Color grade' } },
  'en-GB': EN,
  'es-419': ES,
  'es-ES': { ...ES, adaptiveNote: 'Reduce la resolución cuando los fotogramas van lentos y la sube cuando van rápidos.' },
  'de-DE': {
    section: 'Grafik',
    quality: 'Qualität',
    auto: 'Automatisch (erkannt: {tier})',
    fromPreset: 'Laut Voreinstellung ({tier})',
    renderScale: 'Renderskalierung',
    adaptive: 'Adaptive Auflösung',
    adaptiveNote: 'Senkt die Auflösung bei langsamen Bildern und hebt sie bei schnellen wieder an.',
    showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; der Tisch wird ohne sie dargestellt.',
    noRenderer: 'Die Grafik gilt für den 3D-Gewächshaustisch.',
    unknownGpu: 'unbekannte GPU',
    presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    cats: {
      shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
      antialias: 'Kantenglättung', reflections: 'Spiegelungen', detail: 'Oberflächendetails',
      particles: 'Partikel', background: 'Hintergrund',
    },
    tiers: {
      off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Einfach', detailed: 'Detailliert',
      static: 'Statisch', animated: 'Animiert',
    },
    words: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Leuchteffekt', noAa: 'keine Kantenglättung', ibl: 'Spiegelungen' },
  },
  'fr-FR': FR,
  'fr-CA': { ...FR, section: 'Graphiques', adaptiveNote: 'Baisse la résolution quand les images ralentissent et la remonte quand elles sont rapides.' },
  'pt-BR': {
    section: 'Gráficos',
    quality: 'Qualidade',
    auto: 'Automática (detectada: {tier})',
    fromPreset: 'Conforme a predefinição ({tier})',
    renderScale: 'Escala de renderização',
    adaptive: 'Resolução adaptável',
    adaptiveNote: 'Reduz a resolução quando os quadros ficam lentos e aumenta quando ficam rápidos.',
    showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; a mesa é exibida sem ele.',
    noRenderer: 'Os gráficos se aplicam à mesa 3D da estufa.',
    unknownGpu: 'GPU desconhecida',
    presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: {
      shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor',
      antialias: 'Antisserrilhado', reflections: 'Reflexos', detail: 'Detalhe das superfícies',
      particles: 'Partículas', background: 'Fundo',
    },
    tiers: {
      off: 'Desligado', on: 'Ligado', low: 'Baixas', medium: 'Médias', high: 'Altas',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
      static: 'Estático', animated: 'Animado',
    },
    words: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa', bloom: 'brilho', noAa: 'sem antisserrilhado', ibl: 'reflexos' },
  },
  'it-IT': {
    section: 'Grafica',
    quality: 'Qualità',
    auto: 'Automatica (rilevata: {tier})',
    fromPreset: 'Dal preset ({tier})',
    renderScale: 'Scala di rendering',
    adaptive: 'Risoluzione adattiva',
    adaptiveNote: 'Abbassa la risoluzione quando i fotogrammi rallentano e la rialza quando sono veloci.',
    showFps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; il tavolo viene mostrato senza.',
    noRenderer: 'La grafica si applica al tavolo 3D della serra.',
    unknownGpu: 'GPU sconosciuta',
    presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    cats: {
      shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
      antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici',
      particles: 'Particelle', background: 'Sfondo',
    },
    tiers: {
      off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
      static: 'Statico', animated: 'Animato',
    },
    words: { noShadows: 'senza ombre', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', noAa: 'senza antialiasing', ibl: 'riflessi' },
  },
};

export const GFX_LOCALES = Object.keys(STRINGS);

/** Best supported locale for a list of BCP-47 tags (e.g. navigator.languages). */
export function pickGfxLocale(tags) {
  const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean).map(String);
  for (const tag of list) {
    const t = tag.replace('_', '-');
    const exact = GFX_LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    const lang = t.split('-')[0].toLowerCase();
    const region = (t.split('-')[1] || '').toUpperCase();
    if (lang === 'en') return region === 'US' ? 'en-US' : 'en-GB';
    if (lang === 'es') return region === 'ES' ? 'es-ES' : 'es-419';
    if (lang === 'fr') return region === 'CA' ? 'fr-CA' : 'fr-FR';
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
  }
  return 'en-GB';
}

export function gfxStrings(locale) {
  return STRINGS[locale] || EN;
}
