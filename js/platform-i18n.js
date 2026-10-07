// Patience Garden — strings for the StarHermit account controls (sign-in,
// invite). Follows the browser language like the Graphics panel.
import { pickGfxLocale } from './gfx-i18n.js';

const EN_US = {
  signIn: 'Sign in with StarHermit',
  invite: 'Invite a friend',
  inviteCopied: 'Invite link copied to the clipboard.',
  inviteFailed: 'Copy this invite link: {link}',
  signedOut: 'Signed out of StarHermit — progress keeps saving on this device.',
  lbPosting: 'Posting score to the leaderboard…',
  lbRank: 'Leaderboard rank: #{rank}',
  lbPosted: 'Score posted to the leaderboard.',
  lbNotPosted: 'Score not posted to the leaderboard.',
};

const STRINGS = {
  'en-US': EN_US,
  'en-GB': { ...EN_US },
  'es-419': {
    signIn: 'Iniciar sesión con StarHermit',
    invite: 'Invitar a un amigo',
    inviteCopied: 'Enlace de invitación copiado al portapapeles.',
    inviteFailed: 'Copia este enlace de invitación: {link}',
    signedOut: 'Se cerró la sesión de StarHermit; el progreso se sigue guardando en este dispositivo.',
    lbPosting: 'Publicando la puntuación en la clasificación…',
    lbRank: 'Puesto en la clasificación: #{rank}',
    lbPosted: 'Puntuación publicada en la clasificación.',
    lbNotPosted: 'La puntuación no se publicó en la clasificación.',
  },
  'es-ES': {
    signIn: 'Iniciar sesión con StarHermit',
    invite: 'Invitar a un amigo',
    inviteCopied: 'Enlace de invitación copiado al portapapeles.',
    inviteFailed: 'Copia este enlace de invitación: {link}',
    signedOut: 'Se ha cerrado la sesión de StarHermit; el progreso se sigue guardando en este dispositivo.',
    lbPosting: 'Publicando la puntuación en la clasificación…',
    lbRank: 'Puesto en la clasificación: #{rank}',
    lbPosted: 'Puntuación publicada en la clasificación.',
    lbNotPosted: 'La puntuación no se ha publicado en la clasificación.',
  },
  'de-DE': {
    signIn: 'Mit StarHermit anmelden',
    invite: 'Freund einladen',
    inviteCopied: 'Einladungslink in die Zwischenablage kopiert.',
    inviteFailed: 'Kopiere diesen Einladungslink: {link}',
    signedOut: 'Von StarHermit abgemeldet – der Fortschritt wird weiter auf diesem Gerät gespeichert.',
    lbPosting: 'Punktzahl wird an die Bestenliste gesendet …',
    lbRank: 'Platz in der Bestenliste: #{rank}',
    lbPosted: 'Punktzahl in der Bestenliste eingetragen.',
    lbNotPosted: 'Punktzahl nicht in der Bestenliste eingetragen.',
  },
  'fr-FR': {
    signIn: 'Se connecter avec StarHermit',
    invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.',
    inviteFailed: 'Copiez ce lien d’invitation : {link}',
    signedOut: 'Déconnecté de StarHermit — la progression reste enregistrée sur cet appareil.',
    lbPosting: 'Envoi du score au classement…',
    lbRank: 'Rang au classement : #{rank}',
    lbPosted: 'Score publié au classement.',
    lbNotPosted: 'Score non publié au classement.',
  },
  'fr-CA': {
    signIn: 'Se connecter avec StarHermit',
    invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.',
    inviteFailed: 'Copiez ce lien d’invitation : {link}',
    signedOut: 'Déconnecté de StarHermit — la progression reste enregistrée sur cet appareil.',
    lbPosting: 'Envoi du pointage au classement…',
    lbRank: 'Rang au classement : #{rank}',
    lbPosted: 'Pointage publié au classement.',
    lbNotPosted: 'Pointage non publié au classement.',
  },
  'pt-BR': {
    signIn: 'Entrar com StarHermit',
    invite: 'Convidar um amigo',
    inviteCopied: 'Link de convite copiado para a área de transferência.',
    inviteFailed: 'Copie este link de convite: {link}',
    signedOut: 'Você saiu do StarHermit — o progresso continua salvo neste dispositivo.',
    lbPosting: 'Enviando a pontuação para o ranking…',
    lbRank: 'Posição no ranking: #{rank}',
    lbPosted: 'Pontuação enviada para o ranking.',
    lbNotPosted: 'A pontuação não foi enviada para o ranking.',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit',
    invite: 'Invita un amico',
    inviteCopied: 'Link di invito copiato negli appunti.',
    inviteFailed: 'Copia questo link di invito: {link}',
    signedOut: 'Disconnesso da StarHermit: i progressi continuano a essere salvati su questo dispositivo.',
    lbPosting: 'Invio del punteggio alla classifica…',
    lbRank: 'Posizione in classifica: #{rank}',
    lbPosted: 'Punteggio pubblicato in classifica.',
    lbNotPosted: 'Punteggio non pubblicato in classifica.',
  },
};

export const PLATFORM_LOCALES = Object.keys(STRINGS);

export function platformStrings(locale) {
  return STRINGS[locale] || EN_US;
}

/** Strings for the browser's language. */
export function currentPlatformStrings() {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : [];
  return platformStrings(pickGfxLocale(langs));
}
