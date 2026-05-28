/* ============================================================
   TASKFLOW — app.js
   Responsabilidades:
     1. Lógica completa do To-Do List (CRUD + localStorage)
     2. Manipulação do DOM (renderização de tarefas, filtros, stats)
     3. Registro do Service Worker (com tratamento de erros)
     4. Eventos PWA: beforeinstallprompt (banner de instalação)
                     online/offline (banner de status de rede)
   ============================================================ */

'use strict';

/* ── CONSTANTES ──────────────────────────────────────────── */
const STORAGE_KEY = 'taskflow_tasks';    // Chave no localStorage
const MAX_CHARS   = 120;                 // Limite de caracteres por tarefa

/* ── SELETORES DO DOM ────────────────────────────────────── */
const taskInput       = document.getElementById('task-input');
const btnAdd          = document.getElementById('btn-add');
const taskList        = document.getElementById('task-list');
const emptyState      = document.getElementById('empty-state');
const charCounter     = document.getElementById('char-counter');
const filterBtns      = document.querySelectorAll('.filter-btn');
const btnClearDone    = document.getElementById('btn-clear-done');
const offlineBanner   = document.getElementById('offline-banner');
const installBanner   = document.getElementById('install-banner');
const btnInstall      = document.getElementById('btn-install');
const btnInstallDismiss = document.getElementById('btn-install-dismiss');
const countTotal      = document.getElementById('count-total');
const countPending    = document.getElementById('count-pending');
const countDone       = document.getElementById('count-done');

/* ── ESTADO DA APLICAÇÃO ─────────────────────────────────── */
let tasks         = [];         // Array em memória com todas as tarefas
let activeFilter  = 'all';      // Filtro ativo: 'all' | 'pending' | 'done'
let deferredPrompt = null;      // Referência ao evento beforeinstallprompt (PWA)

/* ==============================================================
   SEÇÃO 1 — PERSISTÊNCIA: localStorage
   O localStorage é um storage de chave/valor no navegador que
   persiste os dados mesmo após fechar a aba ou recarregar.
   Usamos JSON.stringify/parse para serializar o array de tarefas.
   ============================================================== */

/**
 * Carrega as tarefas salvas no localStorage.
 * Retorna um array vazio se não houver dados.
 */
function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error('[TaskFlow] Erro ao carregar tarefas do localStorage:', err);
    return [];
  }
}

/**
 * Persiste o array de tarefas atual no localStorage.
 */
function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error('[TaskFlow] Erro ao salvar tarefas no localStorage:', err);
  }
}

/* ==============================================================
   SEÇÃO 2 — LÓGICA DE TAREFAS (CRUD)
   ============================================================== */

/**
 * Cria um objeto de tarefa com ID único, texto, status e timestamp.
 * @param {string} text - Texto da tarefa
 * @returns {Object} - Objeto de tarefa
 */
function createTask(text) {
  return {
    id:        `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text:      text.trim(),
    done:      false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Adiciona uma nova tarefa ao array e atualiza a UI.
 */
function addTask() {
  const text = taskInput.value.trim();
  if (!text) {
    taskInput.focus();
    taskInput.classList.add('shake');             // Feedback visual
    setTimeout(() => taskInput.classList.remove('shake'), 400);
    return;
  }

  const task = createTask(text);
  tasks.unshift(task);     // Adiciona no início (mais recente primeiro)
  saveTasks();

  taskInput.value = '';
  updateCharCounter('');
  taskInput.focus();

  render();
}

/**
 * Alterna o status done/pending de uma tarefa pelo seu ID.
 * @param {string} id - ID da tarefa
 */
function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  saveTasks();
  render();
}

/**
 * Remove uma tarefa do array pelo seu ID, com animação.
 * @param {string} id  - ID da tarefa
 * @param {HTMLElement} el - Elemento DOM do item
 */
function deleteTask(id, el) {
  el.classList.add('removing');   // Inicia animação de saída (CSS)
  // Espera a animação terminar antes de remover do estado
  el.addEventListener('transitionend', () => {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  }, { once: true });
}

/**
 * Remove todas as tarefas marcadas como concluídas.
 */
function clearDoneTasks() {
  tasks = tasks.filter(t => !t.done);
  saveTasks();
  render();
}

/* ==============================================================
   SEÇÃO 3 — RENDERIZAÇÃO DO DOM
   ============================================================== */

/**
 * Retorna o array de tarefas filtrado pelo filtro ativo.
 * @returns {Array}
 */
function getFilteredTasks() {
  switch (activeFilter) {
    case 'pending': return tasks.filter(t => !t.done);
    case 'done':    return tasks.filter(t =>  t.done);
    default:        return tasks;
  }
}

/**
 * Formata uma string ISO de data para exibição compacta.
 * @param {string} iso - Data em formato ISO
 * @returns {string} - Ex: "27/05 14:32"
 */
function formatDate(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

/**
 * Cria o elemento DOM de uma tarefa.
 * Usamos createElement para evitar XSS (nunca innerHTML com dados do usuário).
 * @param {Object} task - Objeto de tarefa
 * @returns {HTMLLIElement}
 */
function createTaskElement(task) {
  const li = document.createElement('li');
  li.classList.add('task-item');
  if (task.done) li.classList.add('done');
  li.dataset.id = task.id;
  li.setAttribute('role', 'listitem');

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('task-checkbox');
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', `Marcar "${task.text}" como ${task.done ? 'pendente' : 'concluída'}`);
  checkbox.addEventListener('change', () => toggleTask(task.id));

  // Texto
  const span = document.createElement('span');
  span.classList.add('task-text');
  span.textContent = task.text;   // textContent = seguro contra XSS

  // Data
  const date = document.createElement('span');
  date.classList.add('task-date');
  date.textContent = formatDate(task.createdAt);
  date.setAttribute('title', new Date(task.createdAt).toLocaleString('pt-BR'));

  // Botão deletar
  const btnDel = document.createElement('button');
  btnDel.classList.add('task-delete');
  btnDel.textContent = '✕';
  btnDel.setAttribute('aria-label', `Excluir tarefa: ${task.text}`);
  btnDel.addEventListener('click', () => deleteTask(task.id, li));

  li.append(checkbox, span, date, btnDel);
  return li;
}

/**
 * Função principal de renderização.
 * Limpa e reconstrói a lista de tarefas + atualiza estatísticas.
 */
function render() {
  const filtered = getFilteredTasks();

  // Limpa a lista atual
  taskList.innerHTML = '';

  // Exibe estado vazio ou popula a lista
  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    // Fragment para batch DOM update (melhor performance)
    const fragment = document.createDocumentFragment();
    filtered.forEach(task => fragment.appendChild(createTaskElement(task)));
    taskList.appendChild(fragment);
  }

  // Atualiza estatísticas
  const total   = tasks.length;
  const done    = tasks.filter(t => t.done).length;
  const pending = total - done;

  countTotal.textContent   = total;
  countPending.textContent = pending;
  countDone.textContent    = done;

  // Mostra/esconde o botão "Limpar concluídas"
  btnClearDone.style.visibility = done > 0 ? 'visible' : 'hidden';
}

/* ==============================================================
   SEÇÃO 4 — EVENTOS DA UI
   ============================================================== */

// Botão Adicionar
btnAdd.addEventListener('click', addTask);

// Enter no campo de texto
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

// Contador de caracteres em tempo real
taskInput.addEventListener('input', () => updateCharCounter(taskInput.value));

function updateCharCounter(value) {
  const len = value.length;
  charCounter.textContent = `${len} / ${MAX_CHARS}`;
  charCounter.classList.toggle('warn', len > MAX_CHARS * 0.85);
}

// Filtros
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  });
});

// Limpar concluídas
btnClearDone.addEventListener('click', () => {
  if (confirm('Remover todas as tarefas concluídas?')) {
    clearDoneTasks();
  }
});

/* ==============================================================
   SEÇÃO 5 — EVENTOS DE REDE (Online / Offline)
   A API Navigator.onLine e os eventos window 'online'/'offline'
   permitem que a PWA reaja à perda de conectividade em tempo real.
   ============================================================== */

function updateOnlineStatus() {
  if (navigator.onLine) {
    offlineBanner.classList.add('hidden');
  } else {
    offlineBanner.classList.remove('hidden');
  }
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ==============================================================
   SEÇÃO 6 — BANNER DE INSTALAÇÃO DA PWA (A2HS)
   O evento 'beforeinstallprompt' é disparado pelo navegador
   quando a PWA atende todos os critérios de instalação
   (HTTPS, manifest válido, Service Worker registrado).
   Capturamos o evento para exibir um banner customizado no
   momento certo, em vez de depender do mini-infobar padrão.
   ============================================================== */

window.addEventListener('beforeinstallprompt', (e) => {
  console.log('[TaskFlow] Evento beforeinstallprompt capturado — app elegível para instalação.');
  e.preventDefault();              // Impede o banner automático do navegador
  deferredPrompt = e;              // Guarda o evento para uso posterior
  installBanner.classList.remove('hidden');   // Exibe nosso banner customizado
});

// Usuário clicou em "Instalar"
btnInstall.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  installBanner.classList.add('hidden');
  deferredPrompt.prompt();          // Abre o diálogo de instalação nativo

  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[TaskFlow] Resultado da instalação: ${outcome}`);
  deferredPrompt = null;
});

// Usuário dispensou o banner
btnInstallDismiss.addEventListener('click', () => {
  installBanner.classList.add('hidden');
});

// Detecta quando o app foi instalado com sucesso
window.addEventListener('appinstalled', () => {
  console.log('[TaskFlow] ✅ PWA instalada com sucesso na tela inicial!');
  installBanner.classList.add('hidden');
  deferredPrompt = null;
});

/* ==============================================================
   SEÇÃO 7 — REGISTRO DO SERVICE WORKER
   Esta é a etapa que "ativa" o superpoder da PWA.
   O Service Worker (sw.js) é um script que roda em background,
   separado da thread principal, e gerencia cache e requisições.

   REQUISITOS:
     • O site deve ser servido via HTTP ou HTTPS (não file://)
     • O arquivo sw.js deve estar na raiz do projeto
     • O navegador deve suportar Service Workers
       (todos os browsers modernos suportam)
   ============================================================== */

if ('serviceWorker' in navigator) {
  // O evento 'load' garante que o registro não compita com
  // o carregamento inicial dos recursos da página.
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './'   // Escopo: o SW controla todas as páginas dentro desta pasta
      });

      console.log('[TaskFlow] ✅ Service Worker registrado com sucesso!');
      console.log('[TaskFlow] Escopo:', registration.scope);

      // Feedback de atualização disponível
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[TaskFlow] 🔄 Nova versão do Service Worker encontrada, instalando...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[TaskFlow] 🆕 Atualização disponível. Recarregue para aplicar.');
            // Aqui você poderia exibir um toast/notificação ao usuário
          }
        });
      });

    } catch (error) {
      // Erros comuns:
      //   - Arquivo sw.js não encontrado (404)
      //   - Escopo inválido
      //   - Protocolo file:// em vez de http://
      console.error('[TaskFlow] ❌ Falha ao registrar o Service Worker:', error);
    }
  });
} else {
  // Browsers muito antigos que não suportam SW
  console.warn('[TaskFlow] ⚠️ Este navegador não suporta Service Workers. Modo offline indisponível.');
}

/* ==============================================================
   SEÇÃO 8 — INICIALIZAÇÃO
   ============================================================== */

function init() {
  tasks = loadTasks();         // Carrega tarefas do localStorage
  updateOnlineStatus();        // Verifica status de rede imediatamente
  render();                    // Renderiza a lista inicial

  console.log(`[TaskFlow] 🚀 App iniciado. ${tasks.length} tarefa(s) carregada(s) do localStorage.`);
}

// Inicia o app!
init();
