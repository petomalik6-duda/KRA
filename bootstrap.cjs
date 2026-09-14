console.log('[bootstrap] starting KRA Direct addon');
console.log('[bootstrap] node', process.version, 'port', process.env.PORT || '(unset)');
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e && e.stack ? e.stack : e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e && e.stack ? e.stack : e); process.exit(1); });
import('./direct-server.js').catch((e) => { console.error('[bootstrap import failed]', e && e.stack ? e.stack : e); process.exit(1); });
