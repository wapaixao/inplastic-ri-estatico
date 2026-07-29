require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise((resolve) => rl.question(q, resolve)); }

(async () => {
  try {
    const username = (await ask('Usuário: ')).trim();
    const name = (await ask('Nome: ')).trim();
    const role = (await ask('Papel (diretoria/colaborador): ')).trim();
    const password = await ask('Senha temporária: ');
    if (!username || !name || !password) throw new Error('Usuário, nome e senha são obrigatórios.');
    if (!['diretoria', 'colaborador'].includes(role)) throw new Error('Papel inválido.');
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(`
      INSERT INTO users (username, password_hash, name, role, active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        name = excluded.name,
        role = excluded.role,
        active = 1,
        updated_at = datetime('now')
    `).run(username, hash, name, role);
    console.log('Usuário criado/atualizado com sucesso.');
  } catch (err) {
    console.error('Erro:', err.message);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
})();
