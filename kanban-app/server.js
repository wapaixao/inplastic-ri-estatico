require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.includes('troque') || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET obrigatório, aleatório e com pelo menos 32 caracteres. Gere com: openssl rand -hex 32');
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(BASE_PATH || '/', express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

class BetterSqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);
    `);
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expired_at FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expired_at <= Date.now()) {
        if (row) this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge || 1000 * 60 * 60 * 12;
      const expiredAt = Date.now() + maxAge;
      this.db.prepare(`
        INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at
      `).run(sid, JSON.stringify(sess), expiredAt);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  destroy(sid, cb) {
    try { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb && cb(null); }
    catch (err) { cb && cb(err); }
  }
}

app.use(session({
  store: new BetterSqliteSessionStore(db),
  secret: SESSION_SECRET,
  name: 'inplastic_kanban.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

function canAccessBoard(user, slug) {
  if (user.role === 'diretoria') return true;
  return slug === 'colaboradores';
}

function getColumnWithBoard(columnId) {
  return db.prepare(`
    SELECT columns.*, boards.slug AS board_slug, boards.id AS board_id
    FROM columns
    JOIN boards ON boards.id = columns.board_id
    WHERE columns.id = ?
  `).get(columnId);
}

function getCardWithBoard(cardId) {
  return db.prepare(`
    SELECT cards.*, columns.board_id, boards.slug AS board_slug
    FROM cards
    JOIN columns ON columns.id = cards.column_id
    JOIN boards ON boards.id = columns.board_id
    WHERE cards.id = ?
  `).get(cardId);
}

function normalizeColumnPositions(columnId) {
  const cards = db.prepare('SELECT id FROM cards WHERE column_id = ? ORDER BY position, updated_at, id').all(columnId);
  const stmt = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  cards.forEach((card, idx) => stmt.run(idx, card.id));
}

function logActivity({ cardId, user, action, fromColumnId = null, toColumnId = null, metadata = {} }) {
  db.prepare(`
    INSERT INTO card_activity (card_id, user_id, username, action, from_column_id, to_column_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cardId || null, user?.id || null, user?.username || '', action, fromColumnId, toColumnId, JSON.stringify(metadata));
}

function cleanString(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function assertPriority(priority) {
  return ['baixa', 'media', 'alta'].includes(priority) ? priority : 'media';
}

router.post('/api/login', loginLimiter, (req, res) => {
  const username = cleanString(req.body.username, 80);
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erro ao iniciar sessão' });
    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
    res.json({ user: req.session.user });
  });
});

router.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

router.get('/api/boards', requireAuth, (req, res) => {
  const boards = db.prepare('SELECT * FROM boards ORDER BY id').all()
    .filter((b) => canAccessBoard(req.session.user, b.slug));
  res.json({ boards });
});

router.get('/api/boards/:slug', requireAuth, (req, res) => {
  const slug = cleanString(req.params.slug, 80);
  if (!canAccessBoard(req.session.user, slug)) return res.status(403).json({ error: 'Sem acesso a este quadro' });
  const board = db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
  if (!board) return res.status(404).json({ error: 'Quadro não encontrado' });

  const columns = db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(board.id);
  const cards = db.prepare(`
    SELECT cards.* FROM cards
    JOIN columns ON columns.id = cards.column_id
    WHERE columns.board_id = ?
    ORDER BY cards.position, cards.id
  `).all(board.id);
  const columnsWithCards = columns.map((col) => ({ ...col, cards: cards.filter((c) => c.column_id === col.id) }));
  res.json({ board, columns: columnsWithCards });
});

router.get('/api/cards/:id/activity', requireAuth, (req, res) => {
  const card = getCardWithBoard(req.params.id);
  if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });
  if (!canAccessBoard(req.session.user, card.board_slug)) return res.status(403).json({ error: 'Sem acesso' });
  const activity = db.prepare('SELECT * FROM card_activity WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(card.id);
  res.json({ activity });
});

router.post('/api/cards', requireAuth, (req, res) => {
  const columnId = Number(req.body.column_id);
  const title = cleanString(req.body.title, 160);
  if (!columnId || !title) return res.status(400).json({ error: 'column_id e title são obrigatórios' });

  const column = getColumnWithBoard(columnId);
  if (!column) return res.status(404).json({ error: 'Coluna não encontrada' });
  if (!canAccessBoard(req.session.user, column.board_slug)) return res.status(403).json({ error: 'Sem acesso' });

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE column_id = ?').get(columnId).m;
  const info = db.prepare(`
    INSERT INTO cards (column_id, title, description, assignee, priority, due_date, position, created_by, created_by_user_id, updated_by, updated_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    columnId,
    title,
    cleanString(req.body.description, 3000),
    cleanString(req.body.assignee, 120),
    assertPriority(req.body.priority || 'media'),
    req.body.due_date || null,
    maxPos + 1,
    req.session.user.name,
    req.session.user.id,
    req.session.user.name,
    req.session.user.id,
  );
  logActivity({ cardId: info.lastInsertRowid, user: req.session.user, action: 'created', toColumnId: columnId, metadata: { title } });
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ card });
});

router.put('/api/cards/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const card = getCardWithBoard(id);
  if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });
  if (!canAccessBoard(req.session.user, card.board_slug)) return res.status(403).json({ error: 'Sem acesso' });

  let targetColumn = null;
  if (req.body.column_id !== undefined) {
    targetColumn = getColumnWithBoard(Number(req.body.column_id));
    if (!targetColumn) return res.status(404).json({ error: 'Coluna destino não encontrada' });
    if (!canAccessBoard(req.session.user, targetColumn.board_slug)) return res.status(403).json({ error: 'Sem acesso à coluna destino' });
    if (targetColumn.board_id !== card.board_id) return res.status(400).json({ error: 'Não é permitido mover cartão entre quadros' });
  }

  const next = {
    title: req.body.title !== undefined ? cleanString(req.body.title, 160) : card.title,
    description: req.body.description !== undefined ? cleanString(req.body.description, 3000) : card.description,
    assignee: req.body.assignee !== undefined ? cleanString(req.body.assignee, 120) : card.assignee,
    priority: req.body.priority !== undefined ? assertPriority(req.body.priority) : card.priority,
    due_date: req.body.due_date !== undefined ? (req.body.due_date || null) : card.due_date,
    column_id: targetColumn ? targetColumn.id : card.column_id,
    position: req.body.position !== undefined ? Math.max(0, Number(req.body.position) || 0) : card.position,
  };
  if (!next.title) return res.status(400).json({ error: 'Título é obrigatório' });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE cards
      SET title = ?, description = ?, assignee = ?, priority = ?, due_date = ?, column_id = ?, position = ?,
          updated_by = ?, updated_by_user_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(next.title, next.description, next.assignee, next.priority, next.due_date, next.column_id, next.position, req.session.user.name, req.session.user.id, id);
    normalizeColumnPositions(card.column_id);
    if (next.column_id !== card.column_id) normalizeColumnPositions(next.column_id);
    logActivity({
      cardId: id,
      user: req.session.user,
      action: next.column_id !== card.column_id ? 'moved' : 'updated',
      fromColumnId: card.column_id,
      toColumnId: next.column_id,
      metadata: { changed: Object.keys(req.body) },
    });
  });
  tx();

  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  res.json({ card: updated });
});

router.delete('/api/cards/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const card = getCardWithBoard(id);
  if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });
  if (!canAccessBoard(req.session.user, card.board_slug)) return res.status(403).json({ error: 'Sem acesso' });
  const tx = db.transaction(() => {
    logActivity({ cardId: id, user: req.session.user, action: 'deleted', fromColumnId: card.column_id, metadata: { title: card.title } });
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    normalizeColumnPositions(card.column_id);
  });
  tx();
  res.json({ ok: true });
});

app.use(BASE_PATH || '/', router);
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => console.log(`Kanban InPlastic rodando em http://localhost:${PORT}${BASE_PATH || ''}`));
