// Patience Garden — strings for the StarHermit account controls (sign-in,
// invite). Follows the browser language like the Graphics panel.
import { pickGfxLocale } from './gfx-i18n.js';

const EN_US = {
  signIn: 'Sign in with StarHermit',
  invite: 'Invite a friend',
  inviteCopied: 'Invite link copied to the clipboard.',
  inviteFailed: 'Copy this invite link: {link}',
  signedOut: 'Signed out of StarHermit — progress keeps saving on this device.',
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
  },
  'es-ES': {
    signIn: 'Iniciar sesión con StarHermit',
    invite: 'Invitar a un amigo',
    inviteCopied: 'Enlace de invitación copiado al portapapeles.',
    inviteFailed: 'Copia este enlace de invitación: {link}',
    signedOut: 'Se ha cerrado la sesión de StarHermit; el progreso se sigue guardando en este dispositivo.',
  },
  'de-DE': {
    signIn: 'Mit StarHermit anmelden',
    invite: 'Freund einladen',
    inviteCopied: 'Einladungslink in die Zwischenablage kopiert.',
    inviteFailed: 'Kopiere diesen Einladungslink: {link}',
    signedOut: 'Von StarHermit abgemeldet – der Fortschritt wird weiter auf diesem Gerät gespeichert.',
  },
  'fr-FR': {
    signIn: 'Se connecter avec StarHermit',
    invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.',
    inviteFailed: 'Copiez ce lien d’invitation : {link}',
    signedOut: 'Déconnecté de StarHermit — la progression reste enregistrée sur cet appareil.',
  },
  'fr-CA': {
    signIn: 'Se connecter avec StarHermit',
    invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.',
    inviteFailed: 'Copiez ce lien d’invitation : {link}',
    signedOut: 'Déconnecté de StarHermit — la progression reste enregistrée sur cet appareil.',
  },
  'pt-BR': {
    signIn: 'Entrar com StarHermit',
    invite: 'Convidar um amigo',
    inviteCopied: 'Link de convite copiado para a área de transferência.',
    inviteFailed: 'Copie este link de convite: {link}',
    signedOut: 'Você saiu do StarHermit — o progresso continua salvo neste dispositivo.',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit',
    invite: 'Invita un amico',
    inviteCopied: 'Link di invito copiato negli appunti.',
    inviteFailed: 'Copia questo link di invito: {link}',
    signedOut: 'Disconnesso da StarHermit: i progressi continuano a essere salvati su questo dispositivo.',
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
