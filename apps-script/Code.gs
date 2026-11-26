/**
 * Agitur – backend de leads (Google Apps Script + Google Planilhas)
 * Publicado como App da Web: Executar como "Eu", acesso "Qualquer pessoa".
 * Usuário/senha do /admin ficam nas Propriedades do script (ADMIN_USER / ADMIN_PASS), padrão mk6 / mk6.
 */
var COLS = ['id','criadoEm','nome','whatsapp','whatsappDigitos','destino','quando','pessoas','status','notas','origem',
  'utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer','pagina','userAgent','atualizadoEm'];
var STATUSES = ['novo','em atendimento','fechado','perdido'];
var SESSION_HOURS = 12;

function props_(){ return PropertiesService.getScriptProperties(); }
function cfg_(k, def){ var v = props_().getProperty(k); return v == null || v === '' ? def : v; }

function sheet_(){
  var p = props_(), id = p.getProperty('SHEET_ID'), ss;
  if (id){ try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss){
    ss = SpreadsheetApp.create('Leads – Black Friday Agitur');
    p.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName('Leads');
  if (!sh){
    sh = ss.getSheets()[0];
    sh.setName('Leads');
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#0e1b3e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@');
  }
  return sh;
}

/** Rode uma vez no editor para criar a planilha e autorizar o script. */
function setup(){
  var sh = sheet_();
  if (!props_().getProperty('ADMIN_USER')) props_().setProperty('ADMIN_USER', 'mk6');
  if (!props_().getProperty('ADMIN_PASS')) props_().setProperty('ADMIN_PASS', 'mk6');
  if (!props_().getProperty('SECRET')) props_().setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('Planilha: ' + sh.getParent().getUrl());
}

function clip_(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
function safe_(v){ v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function out_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Sessão ---------- */
function hmac_(s){
  var raw = Utilities.computeHmacSha256Signature(s, cfg_('SECRET', 'agitur'));
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}
function token_(){ var exp = String(Date.now() + SESSION_HOURS * 3600e3); return exp + '.' + hmac_(exp); }
function validToken_(t){
  if (!t) return false;
  t = String(t);
  var i = t.indexOf('.');
  if (i < 0) return false;
  var exp = t.slice(0, i);
  return hmac_(exp) === t.slice(i + 1) && Number(exp) > Date.now();
}

/* ---------- Leitura ---------- */
function readAll_(sh){
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, COLS.length).getDisplayValues();
  return vals.map(function(r, idx){
    var o = { _row: idx + 2, utm: {} };
    COLS.forEach(function(c, j){ if (c.indexOf('utm_') === 0) { if (r[j]) o.utm[c] = r[j]; } else o[c] = r[j]; });
    return o;
  }).filter(function(o){ return o.id; });
}
function findRow_(sh, id){
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

/* ---------- Endpoints ---------- */
function doGet(){ return out_({ ok: true, service: 'agitur-leads' }); }

function doPost(e){
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: 'JSON inválido' }); }
  var action = body.action || 'lead';
  try {
    if (action === 'lead') return out_(addLead_(body));
    if (action === 'login') return out_(login_(body));
    if (!validToken_(body.token)) return out_({ ok: false, error: 'auth' });
    if (action === 'list') return out_({ ok: true, statuses: STATUSES, leads: readAll_(sheet_()).reverse() });
    if (action === 'update') return out_(update_(body));
    if (action === 'delete') return out_(remove_(body));
    return out_({ ok: false, error: 'Ação desconhecida' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function addLead_(b){
  if (b.website) return { ok: true }; // honeypot
  var nome = clip_(b.nome, 120), whats = clip_(b.whats || b.whatsapp, 30), digits = whats.replace(/\D/g, ''), destino = clip_(b.destino, 80);
  if (nome.length < 2 || digits.length < 10 || !destino) return { ok: false, error: 'Dados inválidos' };
  var lead = {
    id: Utilities.getUuid(), criadoEm: new Date().toISOString(), nome: nome, whatsapp: whats, whatsappDigitos: digits,
    destino: destino, quando: clip_(b.quando, 60), pessoas: clip_(b.pessoas, 30), status: 'novo', notas: '',
    origem: clip_(b.origem || 'Formulário Black Friday', 80),
    utm_source: clip_(b.utm_source, 150), utm_medium: clip_(b.utm_medium, 150), utm_campaign: clip_(b.utm_campaign, 150),
    utm_content: clip_(b.utm_content, 150), utm_term: clip_(b.utm_term, 150),
    referrer: clip_(b.referrer, 300), pagina: clip_(b.pagina, 300), userAgent: clip_(b.userAgent, 300), atualizadoEm: ''
  };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { sheet_().appendRow(COLS.map(function(c){ return safe_(lead[c]); })); } finally { lock.releaseLock(); }
  return { ok: true, id: lead.id };
}

function login_(b){
  var cache = CacheService.getScriptCache(), fails = Number(cache.get('fails') || 0);
  if (fails >= 20) return { ok: false, error: 'bloqueado' };
  if (String(b.user || '') === cfg_('ADMIN_USER', 'mk6') && String(b.pass || '') === cfg_('ADMIN_PASS', 'mk6')){
    cache.remove('fails');
    return { ok: true, token: token_() };
  }
  cache.put('fails', String(fails + 1), 900);
  Utilities.sleep(800);
  return { ok: false, error: 'credenciais' };
}

function update_(b){
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_(), row = findRow_(sh, b.id);
    if (!row) return { ok: false, error: 'Lead não encontrado' };
    if (b.status !== undefined){
      if (STATUSES.indexOf(b.status) < 0) return { ok: false, error: 'Status inválido' };
      sh.getRange(row, COLS.indexOf('status') + 1).setValue(b.status);
    }
    if (b.notas !== undefined) sh.getRange(row, COLS.indexOf('notas') + 1).setValue(safe_(clip_(b.notas, 2000)));
    sh.getRange(row, COLS.indexOf('atualizadoEm') + 1).setValue(new Date().toISOString());
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function remove_(b){
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_(), row = findRow_(sh, b.id);
    if (!row) return { ok: false, error: 'Lead não encontrado' };
    sh.deleteRow(row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
