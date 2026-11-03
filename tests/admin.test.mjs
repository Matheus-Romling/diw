import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('permissões administrativas e fluxo de reservas', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const original = await readFile(join(root, 'db.json'), 'utf8');
  const dir = await mkdtemp(join(tmpdir(), 'via-admin-test-'));
  const file = join(dir, 'db.json');
  await writeFile(file, original);
  const child = spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, env: { ...process.env, PORT: '0', DB_FILE: file }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    const exited = once(child, 'exit'); child.kill(); await exited;
    assert.ok(resolve(dir).startsWith(join(resolve(tmpdir()), 'via-admin-test-')));
    await rm(dir, { recursive: true, force: true });
  });
  const origin = await new Promise((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
    child.once('error', reject);
    child.stderr.on('data', (chunk) => { clearTimeout(timer); reject(new Error(String(chunk))); });
    child.stdout.on('data', (chunk) => { const match = String(chunk).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timer); resolveOrigin(match[0]); } });
  });
  async function api(path, method = 'GET', data, token) {
    const response = await fetch(`${origin}/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const content = await response.json().catch(() => null);
    return { status: response.status, data: content };
  }
  let admin, client, other, order, car;
  const account = { nome: 'Cliente de teste', cpf: '12345678901', email: 'teste-admin@example.com', telefone: '31999999999', endereco: 'Rua de Teste, 100', profissao: 'Estudante', senha: 'ClienteTeste1!', confirmarSenha: 'ClienteTeste1!' };

  await t.test('páginas e recursos são servidos de public nos mesmos endereços', async () => {
    for (const asset of ['index.html', 'style.css', 'script.js', 'login/index.html', 'login/cadastro.html', 'login/auth.js', 'login/login.js', 'login/login.css', 'admin/index.html', 'admin/admin.js', 'admin/admin.css']) {
      const response = await fetch(`${origin}/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.equal(await response.text(), await readFile(join(root, 'public', asset), 'utf8'), asset);
    }
    for (const [route, asset] of [['/', 'index.html'], ['/login/', 'login/index.html'], ['/admin/', 'admin/index.html']]) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), await readFile(join(root, 'public', asset), 'utf8'), route);
    }
  });
  await t.test('dados administrativos e arquivos locais não são públicos', async () => {
    for (const path of ['administradores', 'db.json', 'admin/credenciais.example.js', 'documents/admin/credenciais.example.js', 'server.mjs']) assert.equal((await api(path)).status, 404, path);
    assert.equal((await api('veiculos', 'POST', {})).status, 401);
    assert.equal((await api('clientes')).data.length, 0);
    assert.equal((await api('pedidos')).data.length, 0);
    assert.equal((await api('veiculos')).data.length, JSON.parse(original).veiculos.length);
  });
  await t.test('links com public redirecionam sem perder parâmetros', async () => {
    for (const path of ['/public/', '/public/index.html', '/public/login/index.html?returnTo=%2Findex.html', '/public/admin/index.html', '/public/style.css']) {
      const response = await fetch(origin + path, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), path.replace(/^\/public/, ''));
    }
    assert.equal((await api('public/db.json')).status, 404);
  });
  await t.test('três contas entram pelo login e senha incorreta é recusada', async () => {
    for (const [index, name] of ['ana', 'bruno', 'carla'].entries()) {
      const result = await api('auth/login', 'POST', { email: `${name}.admin@via.local`, senha: `ViaAdmin0${index + 1}!` });
      assert.equal(result.status, 200); assert.equal(result.data.user.perfil, 'admin'); assert.ok(result.data.token);
      assert.equal(result.data.user.senhaHash, undefined);
      assert.equal(result.data.user._comentarioSenha, undefined);
      if (index === 0) admin = result.data;
    }
    assert.equal((await api('auth/login', 'POST', { email: 'ana.admin@via.local', senha: 'SenhaErrada' })).status, 401);
  });
  await t.test('clientes de demonstração entram sem expor a anotação da senha', async () => {
    for (const [email, senha] of [['marina@example.com', 'ViaCliente01!'], ['lucas@example.com', 'ViaCliente02!']]) {
      const result = await api('auth/login', 'POST', { email, senha });
      assert.equal(result.status, 200);
      assert.equal(result.data.user.perfil, 'cliente');
      assert.equal(result.data.user._comentarioSenha, undefined);
      const profile = (await api('clientes/' + result.data.user.id, 'GET', undefined, result.data.token)).data;
      assert.equal(profile._comentarioSenha, undefined);
      assert.equal(profile.senhaHash, undefined);
    }
  });
  await t.test('cadastro público não cria ou promove administradores', async () => {
    assert.equal((await api('auth/register', 'POST', { ...account, perfil: 'admin' })).status, 400);
    assert.equal((await api('auth/register', 'POST', { ...account, email: 'ana.admin@via.local' })).status, 409);
    const result = await api('auth/register', 'POST', account); assert.equal(result.status, 201);
    client = result.data; assert.equal(client.user.perfil, 'cliente');
    assert.equal((await api('clientes/' + client.user.id, 'PATCH', { perfil: 'admin' }, client.token)).status, 400);
    assert.equal((await api('administradores', 'POST', account, client.token)).status, 404);
    assert.equal((await api('administradores', 'POST', account, admin.token)).status, 404);
    assert.equal((await api('veiculos', 'POST', {}, client.token)).status, 403);
    assert.equal((await api('pedidos/1', 'PATCH', { status: 'Cancelado' }, client.token)).status, 403);
    const own = await api('clientes', 'GET', undefined, client.token); assert.equal(own.data.length, 1); assert.equal(own.data[0].senhaHash, undefined);
  });
  await t.test('reservas pertencem ao cliente; preço e conflitos são verificados no servidor', async () => {
    const future = new Date(); future.setUTCDate(future.getUTCDate() + 60);
    const start = future.toISOString().slice(0, 10); future.setUTCDate(future.getUTCDate() + 2);
    const values = { clienteId: client.user.id, veiculoId: '6', dataInicio: start, dataFim: future.toISOString().slice(0, 10), total: 0.01, diaria: 0.01, status: 'Aprovado' };
    assert.equal((await api('pedidos', 'POST', { ...values, clienteId: '1' }, client.token)).status, 403);
    const result = await api('pedidos', 'POST', values, client.token); assert.equal(result.status, 201); order = result.data;
    const vehicle = (await api('veiculos/6')).data;
    assert.equal(order.total, Number((vehicle.diaria * 2).toFixed(2))); assert.equal(order.status, 'Pendente');
    assert.equal((await api(`pedidos/${order.id}`, 'PATCH', { status: 'Aprovado' }, client.token)).status, 403);
    other = (await api('auth/register', 'POST', { ...account, email: 'outro@example.com', cpf: '12345678902' })).data;
    assert.equal((await api(`pedidos/${order.id}`, 'GET', undefined, other.token)).status, 403);
    assert.equal((await api('pedidos', 'POST', { ...values, clienteId: other.user.id }, other.token)).status, 409);
  });
  await t.test('admin gerencia frota e protege os registros vinculados', async () => {
    const result = await api('veiculos', 'POST', { marca: 'Teste', modelo: 'Novo carro', ano: 2025, lugares: 5, placa: 'ADM1A01', matricula: 'ADM-TEST', categoria: 'SUV', cambio: 'Automático', combustivel: 'Flex', diaria: 180, disponivel: true, corVisual: 'green', imagemArquivo: '' }, admin.token);
    assert.equal(result.status, 201); car = result.data;
    assert.equal((await api(`veiculos/${car.id}`, 'PATCH', { disponivel: false }, admin.token)).data.disponivel, false);
    assert.equal((await api('veiculos/6', 'DELETE', undefined, admin.token)).status, 409);
    assert.equal((await api(`clientes/${client.user.id}`, 'DELETE', undefined, admin.token)).status, 409);
    assert.equal((await api(`veiculos/${car.id}`, 'DELETE', undefined, admin.token)).status, 200);
    assert.equal((await api('clientes', 'GET', undefined, admin.token)).data.length, JSON.parse(original).clientes.length + 2);
  });
  await t.test('aprovação, cancelamento e encerramento de sessão funcionam', async () => {
    assert.equal((await api(`pedidos/${order.id}`, 'PATCH', { status: 'Aprovado' }, admin.token)).data.status, 'Aprovado');
    assert.equal((await api(`pedidos/${order.id}`, 'GET', undefined, client.token)).data.status, 'Aprovado');
    assert.equal((await api(`pedidos/${order.id}`, 'PATCH', { status: 'Cancelado' }, admin.token)).data.status, 'Cancelado');
    assert.equal((await api(`clientes/${other.user.id}`, 'DELETE', undefined, admin.token)).status, 200);
    assert.equal((await api('auth/me', 'GET', undefined, other.token)).status, 401);
    assert.equal((await api('auth/logout', 'POST', undefined, admin.token)).status, 200);
    assert.equal((await api('auth/me', 'GET', undefined, admin.token)).status, 401);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).administradores.length, 3);
    assert.equal(await readFile(join(root, 'db.json'), 'utf8'), original);
  });
});
