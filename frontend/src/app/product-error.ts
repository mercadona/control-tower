const MESSAGES: Readonly<Record<string, string>> = {
  'coordinating-session-already-live': 'Ya hay una sesión coordinadora en marcha.',
  'coordinating-session-opening': 'La sesión coordinadora todavía se está abriendo.',
  'coordinating-session-busy': 'La sesión coordinadora está realizando otra operación. Inténtalo de nuevo cuando termine.',
  'coordinating-session-target-changed': 'La sesión coordinadora ha cambiado. Actualiza la página antes de volver a intentarlo.',
  'malformed-id': 'El ticket no tiene un formato válido.',
  'malformed-repo': 'El repositorio no tiene un formato válido.',
  'malformed-path': 'La ruta local debe ser una ruta absoluta válida.',
  'checkout-not-confirmed': 'La ruta local no corresponde al repositorio indicado.',
  'plan-agent-not-launched': 'No se pudo arrancar el agente de planificación.',
  'session-closure-not-recorded': 'No se pudo guardar el cierre de la sesión. Puedes volver a intentarlo.',
  'session-closure-not-understood': 'No se pudo interpretar el estado guardado del cierre. Puedes volver a intentarlo.',
  'session-not-terminated': 'La sesión todavía no ha terminado. Puedes volver a intentarlo.',
  'session-termination-unconfirmed': 'No se ha podido confirmar que la sesión haya terminado. Puedes volver a intentarlo.',
  'gate-not-from-the-page': 'Esta acción solo se puede realizar desde la página que sirve el backend.',
  'spec-not-freezable': 'El spec todavía no cumple las condiciones para congelarse.',
  'epic-spec-not-understood': 'No se ha podido interpretar el spec del epic.',
  'plan-changed': 'El plan ha cambiado. Revisa la versión nueva antes de volver a intentarlo.',
}

const productError = (code: string, fallback: string): string => MESSAGES[code] ?? fallback

export { productError }
