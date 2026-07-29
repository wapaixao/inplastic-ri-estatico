const state = {
  user: null,
  boards: [],
  currentSlug: null,
  currentBoard: null,
};

const el = (id) => document.getElementById(id);

// ---------- Utilidades de API ----------
async function api(path, options = {}) {
  const base = (window.KANBAN_BASE_PATH || '').replace(/\/$/, '');
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

// ---------- Inicialização ----------
async function init() {
  try {
    const { user } = await api('/api/me');
    state.user = user;
    await showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  el('login-screen').classList.remove('hidden');
  el('app-screen').classList.add('hidden');
}

async function showApp() {
  el('login-screen').classList.add('hidden');
  el('app-screen').classList.remove('hidden');
  el('user-name').textContent = `${state.user.name} (${state.user.role})`;

  const { boards } = await api('/api/boards');
  state.boards = boards;
  renderBoardSwitch();

  const firstSlug = boards[0] && boards[0].slug;
  if (firstSlug) await loadBoard(firstSlug);
}

function renderBoardSwitch() {
  const nav = el('board-switch');
  nav.innerHTML = '';
  state.boards.forEach((b) => {
    const btn = document.createElement('button');
    btn.textContent = b.name;
    btn.className = b.slug === state.currentSlug ? 'active' : '';
    btn.onclick = () => loadBoard(b.slug);
    nav.appendChild(btn);
  });
}

async function loadBoard(slug) {
  state.currentSlug = slug;
  const data = await api(`/api/boards/${slug}`);
  state.currentBoard = data;
  el('board-title').textContent = data.board.name;
  renderBoardSwitch();
  renderBoard();
}

// ---------- Renderização do quadro ----------
function renderBoard() {
  const boardEl = el('board');
  boardEl.innerHTML = '';

  state.currentBoard.columns.forEach((col) => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;

    const overLimit = col.wip_limit && col.cards.length > col.wip_limit;
    colEl.innerHTML = `
      <div class="column-header">
        <h2>${escapeHtml(col.name)}</h2>
        <span class="column-count ${overLimit ? 'over-limit' : ''}">
          ${col.cards.length}${col.wip_limit ? ' / ' + col.wip_limit : ''}
        </span>
      </div>
      <div class="card-list" data-column-id="${col.id}"></div>
      <button class="add-card-btn">+ Novo cartão</button>
    `;

    const cardList = colEl.querySelector('.card-list');
    col.cards.forEach((card) => cardList.appendChild(renderCard(card)));

    colEl.querySelector('.add-card-btn').onclick = () => openCardModal({ column_id: col.id });

    setupColumnDropZone(colEl, cardList);
    boardEl.appendChild(colEl);
  });
}

function renderCard(card) {
  const cardEl = document.createElement('div');
  cardEl.className = 'card';
  cardEl.draggable = true;
  cardEl.dataset.cardId = card.id;
  const overdue = card.due_date && card.due_date < new Date().toISOString().slice(0, 10);
  cardEl.classList.toggle('overdue-card', Boolean(overdue));
  cardEl.innerHTML = `
    <div class="card-title">${escapeHtml(card.title)}</div>
    <div class="card-meta">
      <span class="card-assignee">${escapeHtml(card.assignee || 'Sem responsável')}</span>
      <span class="priority-tag priority-${card.priority}">${labelPriority(card.priority)}</span>
    </div>
    ${card.due_date ? `<div class="card-due ${overdue ? 'overdue' : ''}">Prazo: ${escapeHtml(card.due_date)}</div>` : ''}
  `;
  cardEl.onclick = () => openCardModal(card);

  cardEl.addEventListener('dragstart', () => {
    cardEl.classList.add('dragging');
  });
  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('dragging');
  });

  return cardEl;
}

function labelPriority(p) {
  return { baixa: 'Baixa', media: 'Média', alta: 'Alta' }[p] || p;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Drag and drop ----------
function setupColumnDropZone(colEl, cardList) {
  colEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    colEl.classList.add('drag-over');
    const dragging = document.querySelector('.card.dragging');
    if (!dragging) return;
    const after = getDragAfterElement(cardList, e.clientY);
    if (after == null) {
      cardList.appendChild(dragging);
    } else {
      cardList.insertBefore(dragging, after);
    }
  });

  colEl.addEventListener('dragleave', (e) => {
    if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('drag-over');
  });

  colEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    colEl.classList.remove('drag-over');
    const dragging = document.querySelector('.card.dragging');
    if (!dragging) return;

    const cardId = dragging.dataset.cardId;
    const newColumnId = Number(colEl.dataset.columnId);
    const cardsInColumn = [...cardList.querySelectorAll('.card')];
    const newPosition = cardsInColumn.indexOf(dragging);

    try {
      await api(`/api/cards/${cardId}`, {
        method: 'PUT',
        body: JSON.stringify({ column_id: newColumnId, position: newPosition }),
      });
      await loadBoard(state.currentSlug);
    } catch (err) {
      alert('Não foi possível mover o cartão: ' + err.message);
      await loadBoard(state.currentSlug);
    }
  });
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ---------- Modal de cartão ----------
function openCardModal(card) {
  const isNew = !card.id;
  el('modal-title').textContent = isNew ? 'Novo cartão' : 'Editar cartão';
  el('card-id').value = card.id || '';
  el('card-column-id').value = card.column_id;
  el('card-title').value = card.title || '';
  el('card-description').value = card.description || '';
  el('card-assignee').value = card.assignee || '';
  el('card-priority').value = card.priority || 'media';
  el('card-due-date').value = card.due_date || '';
  el('delete-card-btn').classList.toggle('hidden', isNew);
  el('card-modal').classList.remove('hidden');
  loadCardActivity(card.id);
  el('card-title').focus();
}

async function loadCardActivity(cardId) {
  const box = el('card-activity');
  if (!cardId) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  try {
    const { activity } = await api(`/api/cards/${cardId}/activity`);
    box.classList.remove('hidden');
    box.innerHTML = '<strong>Histórico</strong>' + (activity.length ? activity.map((a) => `
      <div class="activity-item">
        <span>${escapeHtml(a.created_at)}</span> — ${escapeHtml(a.username || '')} ${labelAction(a.action)}
      </div>`).join('') : '<div class="activity-item">Sem histórico ainda.</div>');
  } catch {
    box.classList.add('hidden');
  }
}

function labelAction(action) {
  return { created: 'criou o cartão', updated: 'atualizou o cartão', moved: 'moveu o cartão', deleted: 'excluiu o cartão' }[action] || action;
}

function closeCardModal() {
  el('card-modal').classList.add('hidden');
  el('card-form').reset();
  el('card-activity').classList.add('hidden');
  el('card-activity').innerHTML = '';
}

el('cancel-card-btn').onclick = closeCardModal;

el('card-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('card-id').value;
  const payload = {
    column_id: Number(el('card-column-id').value),
    title: el('card-title').value.trim(),
    description: el('card-description').value.trim(),
    assignee: el('card-assignee').value.trim(),
    priority: el('card-priority').value,
    due_date: el('card-due-date').value || null,
  };
  if (!payload.title) return;

  try {
    if (id) {
      await api(`/api/cards/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/cards', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeCardModal();
    await loadBoard(state.currentSlug);
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
});

el('delete-card-btn').onclick = async () => {
  const id = el('card-id').value;
  if (!id || !confirm('Excluir este cartão?')) return;
  try {
    await api(`/api/cards/${id}`, { method: 'DELETE' });
    closeCardModal();
    await loadBoard(state.currentSlug);
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
};

// ---------- Login / logout ----------
el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: el('username').value.trim(),
        password: el('password').value,
      }),
    });
    state.user = user;
    await showApp();
  } catch (err) {
    el('login-error').textContent = err.message;
  }
});

el('logout-btn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  location.reload();
};

init();
