const MESSAGES: Readonly<Record<string, string>> = {
  'coordinating-session-already-live': 'Ya hay una sesión coordinadora en marcha.',
  'coordinating-session-opening': 'La sesión coordinadora todavía se está abriendo.',
  'coordinating-session-working': 'La sesión coordinadora está trabajando. Espera a que termine el turno y vuelve a intentarlo.',
  'coordinating-session-awaiting-permission': 'La sesión coordinadora está esperando un permiso en su terminal. Respóndelo y vuelve a intentarlo.',
  'coordinating-session-turn-not-finished': 'No se sabe qué está mostrando la terminal de la sesión. Espera a que termine un turno y vuelve a intentarlo.',
  'coordinating-session-not-live': 'La sesión coordinadora ya no está viva. Abre otra para seguir.',
  'coordinating-session-busy': 'La sesión coordinadora está realizando otra operación. Inténtalo de nuevo cuando termine.',
  'coordinating-session-target-changed': 'La sesión coordinadora ha cambiado. Actualiza la página antes de volver a intentarlo.',
  'malformed-id': 'El ticket no tiene un formato válido.',
  'malformed-repo': 'El repositorio no tiene un formato válido.',
  'malformed-path': 'La ruta local debe ser una ruta absoluta válida.',
  'checkout-not-confirmed': 'La ruta local no corresponde al repositorio indicado.',
  'plan-agent-not-launched': 'No se pudo arrancar el agente de planificación.',
  'session-closure-not-recorded': 'No se pudo guardar el cierre de la sesión. Puedes volver a intentarlo.',
  'session-closure-not-understood': 'No se pudo interpretar el estado guardado del cierre. Puedes volver a intentarlo.',
  'session-not-terminated': 'No se pudo inspeccionar o terminar la sesión. Vuelve a intentarlo; las sesiones nuevas seguirán bloqueadas hasta confirmar el cierre.',
  'session-termination-unconfirmed': 'No se ha podido confirmar que la sesión haya terminado. Vuelve a intentarlo; las sesiones nuevas seguirán bloqueadas hasta verificar el cierre.',
  'session-termination-permission-denied': 'El sistema no tiene permisos para verificar o terminar la sesión. Corrige los permisos o pide a su propietario que termine la sesión original y vuelve a intentarlo. Las sesiones nuevas seguirán bloqueadas hasta verificar el cierre.',
  'session-ownership-unverifiable': 'No hay identidad original suficiente para terminar la sesión automáticamente. Cierra el terminal original si sigue disponible o pide a su propietario que confirme que terminó y vuelve a verificar. Las sesiones nuevas seguirán bloqueadas hasta confirmar el cierre.',
  'gate-not-from-the-page': 'Esta acción solo se puede realizar desde la página que sirve el backend.',
  'spec-not-freezable': 'El spec todavía no cumple las condiciones para congelarse.',
  'epic-spec-not-understood': 'No se ha podido interpretar el spec del epic.',
  'plan-changed': 'El plan ha cambiado. Revisa la versión nueva antes de volver a intentarlo.',
}

const productError = (code: string, fallback: string): string => MESSAGES[code] ?? fallback

export { productError }
