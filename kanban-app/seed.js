const bcrypt = require('bcryptjs');
const db = require('./db');

function upsertBoard(slug, name) {
  const existing = db.prepare('SELECT id FROM boards WHERE slug = ?').get(slug);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO boards (slug, name) VALUES (?, ?)').run(slug, name).lastInsertRowid;
}

function upsertColumns(boardId, columns) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM columns WHERE board_id = ?').get(boardId);
  if (existing.c > 0) return;
  const stmt = db.prepare('INSERT INTO columns (board_id, name, position, wip_limit) VALUES (?, ?, ?, ?)');
  columns.forEach((col, idx) => stmt.run(boardId, col.name, idx, col.wip_limit || null));
}

function upsertUser(username, password, name, role) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return;
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, active) VALUES (?, ?, ?, ?, 1)')
    .run(username, hash, name, role);
}

const diretoriaId = upsertBoard('diretoria', 'Diretoria');
upsertColumns(diretoriaId, [
  { name: 'Backlog estratégico' },
  { name: 'Em análise' },
  { name: 'Aprovado / em execução', wip_limit: 5 },
  { name: 'Concluído' },
]);

const colaboradoresId = upsertBoard('colaboradores', 'Colaboradores');
upsertColumns(colaboradoresId, [
  { name: 'A fazer' },
  { name: 'Em andamento', wip_limit: 4 },
  { name: 'Em revisão' },
  { name: 'Concluído' },
]);

upsertUser('wagner', 'mudar123', 'Wagner', 'diretoria');
upsertUser('diretor', 'mudar123', 'Diretoria', 'diretoria');
upsertUser('colaborador', 'mudar123', 'Colaborador', 'colaborador');

console.log('Seed concluído.');
console.log('Usuários iniciais criados se ainda não existiam:');
console.log('  wagner / mudar123        | diretoria');
console.log('  diretor / mudar123       | diretoria');
console.log('  colaborador / mudar123   | colaborador');
console.log('Troque as senhas antes de usar em produção.');
