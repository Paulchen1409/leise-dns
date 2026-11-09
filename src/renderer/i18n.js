// German is the default. English is selected in the settings and stored on this device.
(function (global) {
  const de = {
    'nav.dashboard': 'Übersicht',
    'nav.queries': 'Anfragen',
    'nav.filters': 'Filterlisten',
    'nav.allow': 'Erlaubte Domains',
    'nav.block': 'Gesperrte Domains',
    'nav.settings': 'Einstellungen',
    'page.dashboard.sub': 'Weniger Werbung. Mehr Ruhe im Netz.',
    'page.queries.sub': 'Was dein PC anfragt – und was draußen bleibt.',
    'page.filters.sub': 'Gute Voreinstellungen. Volle Kontrolle.',
    'page.allow.sub': 'Diese Domains dürfen immer durch – auch wenn eine Filterliste sie sperrt.',
    'page.block.sub': 'Deine eigenen Sperren, zusätzlich zu den Filterlisten.',
    'page.settings.sub': 'Verbindung, Anbieter und Darstellung.',
    'lang.label': 'Sprache',
    'time.oneMinute': 'Noch eine Minute',
    'time.minutes': 'Noch {minutes} Minuten',
    'conn.down': 'Lokaler DNS-Dienst nicht erreichbar',
    'conn.up': 'Windows-DNS verbunden · {provider} als Anbieter',
    'conn.partial': 'Windows-DNS nur teilweise verbunden',
    'conn.ready': 'Lokaler Dienst bereit · Windows-DNS nicht verbunden',
    'status.approval.pill': 'Freigabe nötig',
    'status.approval.kicker': 'Windows-Freigabe erforderlich',
    'status.approval.title': 'Bitte Windows-Freigabe bestätigen',
    'status.approval.desc': 'Windows fragt nach Administratorrechten. Nach deiner Bestätigung stellt Leise DNS die DNS-Einstellungen dieses PCs um.',
    'status.approval.remember': ' Die Freigabe wird gespeichert, danach fragt Windows nicht mehr.',
    'status.activating.pill': 'Wird eingeschaltet',
    'status.activating.kicker': 'Einen Moment bitte',
    'status.activating.title': 'Schutz wird eingeschaltet …',
    'status.activating.desc': 'Windows-DNS wird auf den lokalen Dienst umgestellt. Der Schutz gilt erst nach der Bestätigung als aktiv.',
    'status.deactivating.pill': 'Wird zurückgesetzt',
    'status.deactivating.kicker': 'Einen Moment bitte',
    'status.deactivating.title': 'DNS wird zurückgesetzt …',
    'status.deactivating.desc': 'Windows erhält die ursprünglichen DNS-Einstellungen zurück.',
    'status.unreachable.pill': 'Dienst gestoppt',
    'status.unreachable.kicker': 'Dienst nicht erreichbar',
    'status.unreachable.title': 'Der lokale DNS-Dienst läuft nicht',
    'status.unreachable.desc': 'Leise DNS konnte keinen lokalen DNS-Dienst auf diesem PC starten. Möglicherweise belegt ein anderes Programm Port 53.',
    'status.unreachable.action': 'Erneut versuchen',
    'status.active.pill': 'Schutz aktiv',
    'status.active.kicker': 'Schutz aktiv · nur auf diesem PC',
    'status.active.title': 'Dein Schutz ist aktiv',
    'status.active.desc': 'Werbung und Tracker werden direkt auf diesem PC blockiert, bevor sie geladen werden.',
    'status.failed.pill': 'Fehler',
    'status.failed.setupKicker': 'Einrichtung fehlgeschlagen',
    'status.failed.resetKicker': 'Zurücksetzen fehlgeschlagen',
    'status.failed.setupTitle': 'Der Schutz konnte nicht eingeschaltet werden',
    'status.failed.resetTitle': 'DNS konnte nicht zurückgesetzt werden',
    'status.failed.setupDesc': 'Deine bisherigen DNS-Einstellungen bleiben erhalten. Die Details stehen unten.',
    'status.failed.resetDesc': 'Die Details stehen unten. Versuche es erneut oder prüfe den Status in den Einstellungen.',
    'status.failed.retry': 'Erneut versuchen',
    'status.failed.on': 'Schutz einschalten',
    'status.timed.pill': 'Pausiert',
    'status.timed.kicker': 'Pausiert',
    'status.timed.title': 'Pausiert bis {time} Uhr',
    'status.timed.desc': '{remaining}. Danach schaltet sich der Schutz automatisch wieder ein.',
    'status.timed.action': 'Jetzt einschalten',
    'status.restart.pill': 'Pausiert',
    'status.restart.kicker': 'Pausiert bis zum App-Neustart',
    'status.restart.title': 'Dein Schutz pausiert',
    'status.restart.desc': 'Er bleibt aus, bis Leise DNS neu gestartet wird. Du kannst ihn jederzeit wieder einschalten.',
    'status.off.pill': 'Ausgeschaltet',
    'status.off.kicker': 'Dauerhaft ausgeschaltet',
    'status.off.title': 'Dein Schutz ist ausgeschaltet',
    'status.off.desc': 'Windows verwendet wieder die ursprünglichen DNS-Einstellungen, bis du den Schutz einschaltest.',
    'status.off.action': 'Schutz einschalten',
    'status.setup.pill': 'Einrichtung nötig',
    'status.setup.kicker': 'Einrichtung erforderlich',
    'status.setup.title': 'Bereit für ein ruhigeres Netz',
    'status.setup.desc': 'Richte den lokalen DNS-Schutz mit einem Klick ein. Windows fragt dabei einmal nach Administratorrechten.',
    'status.setup.partial': 'Windows-DNS ist nur teilweise umgestellt. Richte den Schutz erneut ein, damit alle Netzwerkadapter verbunden sind.',
    'status.setup.action': 'Mit einem Klick einrichten',
    'bypass.title': 'Einige Apps können den Schutz umgehen',
    'bypass.text': 'Chrome, Edge, Firefox, Brave und manche Apps fragen über eigenes verschlüsseltes DNS (DNS-over-HTTPS oder DNS-over-TLS) und sehen den Windows-DNS-Dienst nicht. Leise DNS kann diese Anfragen weder sperren noch zählen. Schalte „Sicheres DNS“ bzw. „DNS über HTTPS“ dort aus, oder stelle es auf den System-DNS-Dienst.'
  };
  const en = {
    'nav.dashboard': 'Overview',
    'nav.queries': 'Queries',
    'nav.filters': 'Filter lists',
    'nav.allow': 'Allowed domains',
    'nav.block': 'Blocked domains',
    'nav.settings': 'Settings',
    'page.dashboard.sub': 'Less advertising. A quieter network.',
    'page.queries.sub': 'What this PC asks for — and what stays out.',
    'page.filters.sub': 'Solid defaults. Full control.',
    'page.allow.sub': 'These domains are always allowed, even if a filter list blocks them.',
    'page.block.sub': 'Your own blocks, in addition to the filter lists.',
    'page.settings.sub': 'Connection, provider and appearance.',
    'lang.label': 'Language',
    'time.oneMinute': 'One minute left',
    'time.minutes': '{minutes} minutes left',
    'conn.down': 'Local DNS service is not reachable',
    'conn.up': 'Windows DNS connected · {provider} as provider',
    'conn.partial': 'Windows DNS only partly connected',
    'conn.ready': 'Local service ready · Windows DNS not connected',
    'status.approval.pill': 'Approval needed',
    'status.approval.kicker': 'Windows approval required',
    'status.approval.title': 'Please confirm the Windows prompt',
    'status.approval.desc': 'Windows asks for administrator rights. After you confirm, Leise DNS switches this PC’s DNS settings.',
    'status.approval.remember': ' The approval is saved, and Windows will not ask again.',
    'status.activating.pill': 'Turning on',
    'status.activating.kicker': 'One moment',
    'status.activating.title': 'Protection is turning on …',
    'status.activating.desc': 'Windows DNS is switching to the local service. Protection counts as active only after that succeeds.',
    'status.deactivating.pill': 'Restoring',
    'status.deactivating.kicker': 'One moment',
    'status.deactivating.title': 'DNS is being restored …',
    'status.deactivating.desc': 'Windows is getting its original DNS settings back.',
    'status.unreachable.pill': 'Service stopped',
    'status.unreachable.kicker': 'Service unreachable',
    'status.unreachable.title': 'The local DNS service is not running',
    'status.unreachable.desc': 'Leise DNS could not start a local DNS service on this PC. Another program may be using port 53.',
    'status.unreachable.action': 'Try again',
    'status.active.pill': 'Protection on',
    'status.active.kicker': 'Protection on · this PC only',
    'status.active.title': 'Your protection is active',
    'status.active.desc': 'Advertising and trackers are blocked on this PC before they load.',
    'status.failed.pill': 'Error',
    'status.failed.setupKicker': 'Setup failed',
    'status.failed.resetKicker': 'Restore failed',
    'status.failed.setupTitle': 'Protection could not be turned on',
    'status.failed.resetTitle': 'DNS could not be restored',
    'status.failed.setupDesc': 'Your previous DNS settings are unchanged. The details are below.',
    'status.failed.resetDesc': 'The details are below. Try again or check the status in Settings.',
    'status.failed.retry': 'Try again',
    'status.failed.on': 'Turn protection on',
    'status.timed.pill': 'Paused',
    'status.timed.kicker': 'Paused',
    'status.timed.title': 'Paused until {time}',
    'status.timed.desc': '{remaining}. Protection then turns itself back on.',
    'status.timed.action': 'Turn on now',
    'status.restart.pill': 'Paused',
    'status.restart.kicker': 'Paused until the app restarts',
    'status.restart.title': 'Your protection is paused',
    'status.restart.desc': 'It stays off until Leise DNS is started again. You can turn it on at any time.',
    'status.off.pill': 'Off',
    'status.off.kicker': 'Switched off',
    'status.off.title': 'Your protection is off',
    'status.off.desc': 'Windows is using the original DNS settings until you turn protection on.',
    'status.off.action': 'Turn protection on',
    'status.setup.pill': 'Setup needed',
    'status.setup.kicker': 'Setup required',
    'status.setup.title': 'Ready for a quieter network',
    'status.setup.desc': 'Set up local DNS protection in one step. Windows asks for administrator rights once.',
    'status.setup.partial': 'Windows DNS is only partly switched. Set protection up again so every adapter is connected.',
    'status.setup.action': 'Set up in one step',
    'bypass.title': 'Some apps can bypass the protection',
    'bypass.text': 'Chrome, Edge, Firefox, Brave and some apps use their own encrypted DNS (DNS over HTTPS or DNS over TLS) and never ask Windows. Leise DNS cannot block or count those queries. Turn off “Secure DNS” or “DNS over HTTPS” in those apps, or set it to the system DNS service.'
  };
  const DICT = { de, en };
  let chosen = null;
  function storage() {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* private mode */ }
    return null;
  }
  function lang() {
    if (chosen === 'en' || chosen === 'de') return chosen;
    const saved = storage()?.getItem('leise.lang');
    return saved === 'en' ? 'en' : 'de';
  }
  function t(key, vars) {
    let text = (DICT[lang()] && DICT[lang()][key]) || DICT.de[key] || key;
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.split('{' + name + '}').join(String(value));
    return text;
  }
  function apply(root) {
    const doc = root || global.document;
    if (!doc?.documentElement) return;
    doc.documentElement.lang = lang() === 'en' ? 'en' : 'de';
    doc.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    doc.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }
  function setLang(next) {
    if (next !== 'en' && next !== 'de') return;
    chosen = next;
    try { storage()?.setItem('leise.lang', next); } catch { /* ignore */ }
    apply();
    global.document?.documentElement?.dispatchEvent(new Event('leise-lang'));
  }
  const api = { t, lang, setLang, apply, DICT };
  global.LeiseI18n = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
