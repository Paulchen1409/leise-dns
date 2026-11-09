// DNS names can carry any bytes. A cell starting with = + - @ (or tab/CR) would run
// as a formula in Excel, so it gets a leading apostrophe.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function queriesToCsv(rows) {
  const lines = rows.map(row => [new Date(row.time).toISOString(), row.domain, row.type || '', row.status, row.reason || '', row.ms ?? ''].map(csvCell).join(','));
  return `\uFEFFtime,domain,type,status,reason,ms\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`;
}
function queriesToJson(rows) {
  return JSON.stringify(rows.map(row => ({
    time: new Date(row.time).toISOString(), domain: row.domain, type: row.type || '', status: row.status, reason: row.reason || '', ms: row.ms ?? 0
  })), null, 2);
}
module.exports = { queriesToCsv, queriesToJson };
