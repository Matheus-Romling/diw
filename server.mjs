import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { randomBytes, randomUUID, pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const db = new Low(new JSONFile(resolve(process.env.DB_FILE || resolve(ROOT, 'db.json'))), {});
await db.read();
const sessions = new Map();
const derive = promisify(pbkdf2);
const CLIENT_FIELDS = ['nome', 'cpf', 'email', 'telefone', 'endereco', 'profissao'];
const CAR_FIELDS = ['marca', 'modelo', 'ano', 'placa', 'matricula', 'categoria', 'cambio', 'lugares', 'combustivel', 'diaria', 'disponivel', 'corVisual', 'imagemArquivo'];
const STATUSES = ['Pendente', 'Aprovado', 'Cancelado'];
let writes = Promise.resolve();

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function find(items, id) { return items?.find((item) => String(item.id) === String(id)); }
function publicUser(user, perfil = 'cliente') {
  return { ...Object.fromEntries(['id', ...CLIENT_FIELDS].map((key) => [key, user[key] ?? ''])), perfil };
}
function mutate(action) {
  const operation = writes.catch(() => {}).then(async () => {
    const next = structuredClone(db.data);
    const result = action(next);
    await db.adapter.write(next);
    db.data = next;
    return result;
  });
  writes = operation;
  return operation;
}
async function hashPassword(password, salt) {
  return (await derive(password, Buffer.from(salt, 'hex'), 210000, 32, 'sha256')).toString('hex');
}
async function validPassword(user, password) {
  const hash = await hashPassword(password, user?.senhaSalt || '0'.repeat(32));
  return !!user?.senhaHash && /^[a-f0-9]{64}$/i.test(user.senhaHash) && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.senhaHash, 'hex'));
}
function sessionUser(req) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) { sessions.delete(token); return null; }
  const account = find(db.data[session.perfil === 'admin' ? 'administradores' : 'clientes'], session.id);
  return account ? { ...publicUser(account, session.perfil), token } : null;
}
function requireUser(req) { return sessionUser(req) || fail(401, 'Entre na sua conta para continuar.'); }
function requireAdmin(req) {
  const user = requireUser(req);
  if (user.perfil !== 'admin') fail(403, 'Acesso não autorizado.');
  return user;
}
function createSession(user, perfil) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { id: user.id, perfil, expires: Date.now() + 30 * 60 * 1000 });
  return { user: publicUser(user, perfil), token };
}
async function body(req) {
  if (!req.headers['content-type']?.includes('application/json')) fail(415, 'Envie os dados em JSON.');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 65536) fail(413, 'Dados enviados excedem o limite.');
  }
  try {
    const data = JSON.parse(raw || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch { fail(400, 'JSON inválido.'); }
}
function clientValues(input, data, id = '') {
  if (Object.keys(input).some((key) => ![...CLIENT_FIELDS, 'senha', 'confirmarSenha'].includes(key))) fail(400, 'O cadastro aceita apenas dados de cliente.');
  const values = Object.fromEntries(CLIENT_FIELDS.map((key) => [key, String(input[key] ?? '').trim()]));
  values.email = values.email.toLowerCase();
  values.cpf = values.cpf.replace(/\D/g, '');
  if (!values.nome || !values.telefone || !values.endereco) fail(400, 'Preencha nome, telefone e endereço.');
  if (values.cpf.length !== 11) fail(400, 'O CPF deve conter 11 dígitos.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) fail(400, 'Informe um e-mail válido.');
  if (data.clientes.some((item) => item.id !== id && item.email.toLowerCase() === values.email) || data.administradores?.some((item) => item.email.toLowerCase() === values.email)) fail(409, 'Já existe uma conta com este e-mail.');
  if (data.clientes.some((item) => item.id !== id && String(item.cpf).replace(/\D/g, '') === values.cpf)) fail(409, 'Já existe uma conta com este CPF.');
  return values;
}
function carValues(input, data, id) {
  const values = Object.fromEntries(CAR_FIELDS.map((key) => [key, input[key]]));
  for (const key of ['marca', 'modelo', 'placa', 'matricula', 'combustivel']) {
    values[key] = String(values[key] ?? '').trim();
    if (!values[key]) fail(400, `Preencha o campo ${key}.`);
  }
  values.placa = values.placa.toUpperCase();
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(values.placa)) fail(400, 'Informe uma placa válida, sem hífen.');
  if (data.veiculos.some((car) => car.id !== id && (car.placa === values.placa || car.matricula === values.matricula))) fail(409, 'A placa ou matrícula já está cadastrada.');
  if (!['Econômico', 'Sedan', 'SUV'].includes(values.categoria) || !['Manual', 'Automático'].includes(values.cambio)) fail(400, 'Categoria ou câmbio inválido.');
  for (const key of ['ano', 'lugares', 'diaria']) values[key] = Number(values[key]);
  if (!Number.isInteger(values.ano) || values.ano < 1900 || values.ano > 2100 || !Number.isInteger(values.lugares) || values.lugares < 1 || values.lugares > 9 || !Number.isFinite(values.diaria) || values.diaria <= 0) fail(400, 'Confira ano, lugares e valor da diária.');
  if (typeof values.disponivel !== 'boolean') fail(400, 'Informe a disponibilidade.');
  values.corVisual = ['green', 'sand', 'blue'].includes(values.corVisual) ? values.corVisual : 'green';
  values.imagemArquivo = String(values.imagemArquivo ?? '').trim();
  if (values.imagemArquivo && !values.imagemArquivo.startsWith('File:')) fail(400, 'O arquivo de imagem deve começar com File:.');
  return values;
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function checkConflict(data, order) {
  if (data.pedidos.some((item) => item.id !== order.id && item.veiculoId === order.veiculoId && item.status !== 'Cancelado' && order.dataInicio < item.dataFim && order.dataFim > item.dataInicio)) fail(409, 'Este veículo já possui uma reserva nesse período.');
}

const assets = new Set(['index.html', 'style.css', 'script.js', 'login/index.html', 'login/cadastro.html', 'login/login.css', 'login/login.js', 'login/auth.js', 'admin/index.html', 'admin/admin.css', 'admin/admin.js']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

export const server = createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) fail(403, 'Origem não autorizada.');
      res.setHeader('Access-Control-Allow-Origin', origin.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const route = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    const method = req.method;

    if (method === 'POST' && route === '/auth/login') {
      const input = await body(req);
      const email = String(input.email ?? '').trim().toLowerCase();
      const admin = db.data.administradores?.find((item) => item.email.toLowerCase() === email);
      const user = admin || db.data.clientes.find((item) => item.email.toLowerCase() === email);
      if (!await validPassword(user, String(input.senha ?? ''))) fail(401, 'E-mail ou senha incorretos.');
      send(200, createSession(user, admin ? 'admin' : 'cliente')); return;
    }
    if (method === 'POST' && route === '/auth/register') {
      const input = await body(req);
      const password = String(input.senha ?? '');
      if (password.length < 8 || password.length > 128 || password !== input.confirmarSenha) fail(400, 'Use pelo menos 8 caracteres e confirme a mesma senha.');
      const salt = randomBytes(16).toString('hex');
      const hash = await hashPassword(password, salt);
      const user = await mutate((data) => {
        const account = { id: randomUUID(), ...clientValues(input, data), senhaSalt: salt, senhaHash: hash };
        data.clientes.push(account); return account;
      });
      send(201, createSession(user, 'cliente')); return;
    }
    if (method === 'GET' && route === '/auth/me') { const user = requireUser(req); const { token, ...profile } = user; send(200, profile); return; }
    if (method === 'POST' && route === '/auth/logout') { const user = requireUser(req); sessions.delete(user.token); send(200, { ok: true }); return; }
    if (method === 'GET' && route === '/resumo') { send(200, { clientes: db.data.clientes.length }); return; }

    const match = route.match(/^\/(veiculos|clientes|pedidos)(?:\/([^/]+))?$/);
    if (match) {
      const [, collection, id] = match;
      const current = id ? find(db.data[collection], id) : null;
      if (id && !current) fail(404, 'Registro não encontrado.');
      const user = sessionUser(req);
      if (method === 'GET') {
        if (collection === 'veiculos') { send(200, id ? current : db.data.veiculos); return; }
        let items = db.data[collection].filter((item) => user && (user.perfil === 'admin' || (collection === 'clientes' ? item.id === user.id : item.clienteId === user.id)));
        if (id) { items = items.filter((item) => item.id === id); if (!items.length) fail(403, 'Acesso não autorizado.'); }
        if (collection === 'clientes') items = items.map((item) => publicUser(item));
        send(200, id ? items[0] : items); return;
      }
      const actor = requireUser(req);
      if (collection === 'veiculos') {
        requireAdmin(req);
        if (!['POST', 'PATCH', 'DELETE'].includes(method) || (method !== 'POST' && !id) || (method === 'POST' && id)) fail(405, 'Operação não permitida.');
        const input = method !== 'DELETE' ? await body(req) : null;
        const result = await mutate((data) => {
          const car = id ? find(data.veiculos, id) : null;
          if (method === 'DELETE') {
            if (data.pedidos.some((order) => order.veiculoId === id)) fail(409, 'Este veículo possui reservas. Marque-o como indisponível para preservar o histórico.');
            data.veiculos = data.veiculos.filter((item) => item.id !== id); return { ok: true };
          }
          const values = carValues({ ...car, ...input }, data, id);
          if (car) Object.assign(car, values);
          else data.veiculos.push({ id: randomUUID(), ...values });
          return car || data.veiculos.at(-1);
        });
        send(method === 'POST' ? 201 : 200, result); return;
      }
      if (collection === 'clientes') {
        if (!id || !['PATCH', 'DELETE'].includes(method)) fail(405, 'Use o cadastro de clientes para criar uma conta.');
        if (actor.perfil !== 'admin' && actor.id !== id) fail(403, 'Acesso não autorizado.');
        const input = method === 'PATCH' ? await body(req) : null;
        if (input && Object.keys(input).some((key) => !CLIENT_FIELDS.includes(key))) fail(400, 'Altere somente os dados cadastrais.');
        const result = await mutate((data) => {
          if (method === 'DELETE') {
            if (data.pedidos.some((order) => order.clienteId === id)) fail(409, 'Este cliente possui reservas e deve ser mantido no histórico.');
            data.clientes = data.clientes.filter((item) => item.id !== id); return { ok: true };
          }
          const account = find(data.clientes, id);
          Object.assign(account, clientValues({ ...Object.fromEntries(CLIENT_FIELDS.map((key) => [key, account[key]])), ...input }, data, id));
          return publicUser(account);
        });
        send(200, result); return;
      }
      if (!['POST', 'PATCH'].includes(method) || (method === 'PATCH' && !id) || (method === 'POST' && id)) fail(405, 'Operação não permitida.');
      if (current && actor.perfil !== 'admin' && current.clienteId !== actor.id) fail(403, 'Acesso não autorizado.');
      const input = await body(req);
      const result = await mutate((data) => {
        const previous = id ? find(data.pedidos, id) : null;
        if (Object.keys(input).length === 1 && input.status) {
          if (!previous || !STATUSES.includes(input.status) || (actor.perfil !== 'admin' && input.status !== 'Cancelado')) fail(403, 'Alteração de status não permitida.');
          if (previous.status === 'Cancelado') fail(409, 'Esta reserva já foi cancelada.');
          if (input.status === 'Aprovado') { if (!find(data.veiculos, previous.veiculoId)?.disponivel) fail(409, 'O veículo está indisponível.'); checkConflict(data, previous); }
          previous.status = input.status; return previous;
        }
        if (previous?.status === 'Cancelado') fail(409, 'Esta reserva já foi cancelada.');
        const clienteId = actor.perfil === 'admin' ? input.clienteId : actor.id;
        if (input.clienteId && input.clienteId !== clienteId) fail(403, 'A reserva deve pertencer à sua conta.');
        const car = find(data.veiculos, input.veiculoId);
        if (!find(data.clientes, clienteId) || !car?.disponivel) fail(409, 'Cliente ou veículo indisponível.');
        if (!validDate(input.dataInicio) || !validDate(input.dataFim) || input.dataFim <= input.dataInicio) fail(400, 'Escolha uma devolução posterior à retirada.');
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        if (input.dataInicio < today && input.dataInicio !== previous?.dataInicio) fail(400, 'A retirada não pode estar no passado.');
        const days = Math.round((Date.parse(input.dataFim) - Date.parse(input.dataInicio)) / 86400000);
        const order = { id: id || randomUUID(), clienteId, veiculoId: car.id, dataInicio: input.dataInicio, dataFim: input.dataFim, diaria: car.diaria, total: Number((days * car.diaria).toFixed(2)), status: 'Pendente', criadoEm: previous?.criadoEm || new Date().toISOString() };
        checkConflict(data, order);
        if (previous) Object.assign(previous, order); else data.pedidos.push(order);
        return order;
      });
      send(method === 'POST' ? 201 : 200, result); return;
    }

    // Aceita links antigos com /public e mantém um único endereço para cada página.
    if (method === 'GET' && (route === '/public' || route.startsWith('/public/'))) {
      const canonical = route.slice('/public'.length) || '/';
      const alias = canonical === '/' ? 'index.html' : canonical === '/login' ? 'login/index.html' : canonical === '/admin' ? 'admin/index.html' : canonical.slice(1);
      if (assets.has(alias)) { res.writeHead(302, { Location: canonical + url.search, 'Cache-Control': 'no-store' }); res.end(); return; }
    }
    const asset = route === '/' ? 'index.html' : route === '/login' ? 'login/index.html' : route === '/admin' ? 'admin/index.html' : route.slice(1);
    if (method === 'GET' && assets.has(asset)) {
      const content = await readFile(resolve(PUBLIC, asset));
      res.writeHead(200, { 'Content-Type': types[extname(asset)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(content); return;
    }
    fail(404, 'Página não encontrada.');
  } catch (error) {
    if (!error.status) console.error(error);
    send(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir a operação.' });
  }
});

server.listen(Number(process.env.PORT || 3000), process.env.HOST || 'localhost', () => console.log(`Via disponível em http://localhost:${server.address().port}`));
